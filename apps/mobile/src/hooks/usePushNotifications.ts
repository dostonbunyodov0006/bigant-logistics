import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { useAuth } from '../auth/AuthContext';
import { shiftPrompt } from '../lib/shiftPrompt';
import { pushToken } from '../lib/pushToken';
import { report } from '../lib/crashReport';

if (Platform.OS !== 'web') {
  import('expo-notifications').then((Notifications) => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowAlert: true,
      } as import('expo-notifications').NotificationBehavior),
    });
  });
}

async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  const Notifications = await import('expo-notifications');
  const settings = await Notifications.getPermissionsAsync();
  const isGranted = (settings as { granted?: boolean; status?: string }).granted
    ?? (settings as { status?: string }).status === 'granted';

  if (!isGranted) {
    const requested = await Notifications.requestPermissionsAsync();
    const nowGranted = (requested as { granted?: boolean; status?: string }).granted
      ?? (requested as { status?: string }).status === 'granted';
    if (!nowGranted) {
      report(new Error('push: notification permission not granted'));
      return null;
    }
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
    });
    // What the server sends on (push.sender.ts): loud and hard to miss. The
    // sound plays on the alarm stream — louder than the notification one, and a
    // driver on the road must hear a new order — and the phone vibrates three
    // times. A new id, because Android fixes a channel's sound and importance
    // the first time it is made; "default" could not be turned up.
    await Notifications.setNotificationChannelAsync('orders_alert', {
      name: 'Buyurtmalar',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
      enableVibrate: true,
      vibrationPattern: [0, 700, 300, 700, 300, 700],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  // The NATIVE FCM token, not getExpoPushTokenAsync(). The backend sends through
  // firebase-admin (getMessaging().sendEachForMulticast), which only accepts real
  // FCM device tokens — an ExponentPushToken[...] is a different scheme and would
  // be rejected per-token, silently, inside PushSender's catch.
  //
  // This needs google-services.json present at build time (see app.json
  // android.googleServicesFile); without it, registration throws here.
  const tokenData = await Notifications.getDevicePushTokenAsync();
  return tokenData.data;
}

export function usePushNotifications() {
  const { user } = useAuth();
  const registered = useRef(false);

  useEffect(() => {
    // Signing out forgets the registration, so the next driver on this phone
    // registers his own.
    if (!user) {
      registered.current = false;
      return;
    }
    if (registered.current) return;
    registered.current = true;
    // Without google-services.json there is no FirebaseApp, and asking Android
    // for the FCM token then kills the app natively — no JS catch can stop it.
    // The flag is about Android's google-services.json; an iPhone registers with Apple.
    if (Platform.OS === 'android' && !Constants.expoConfig?.extra?.pushEnabled) {
      // Silent until now, which is how a whole fleet stopped registering
      // unnoticed (28.10.2026). The office hears of it.
      report(new Error(`push: skipped, pushEnabled=${String(Constants.expoConfig?.extra?.pushEnabled)} expoConfig=${Constants.expoConfig ? 'yes' : 'none'}`));
      return;
    }

    (async () => {
      // registerForPush can throw (permission APIs, or a missing FCM config), and
      // it was previously outside the try — an unhandled rejection. Push is
      // optional, so a failure here must not surface to the driver.
      try {
        const token = await registerForPush();
        if (!token) return;
        await api.post('/notifications/push-token', {
          fcm_token: token,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        });
        pushToken.set(token);
      } catch (err) {
        // Optional for the driver, so nothing is shown to him; the office is told.
        report(new Error(`push: registration failed — ${(err as Error)?.message ?? String(err)}`));
      }
    })();
  }, [user]);

  // A push almost always means an order/status change → refresh the driver's data
  // so a new assignment appears without a manual pull-to-refresh.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subs: { remove: () => void }[] = [];
    void import('expo-notifications').then((Notifications) => {
      const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        void queryClient.invalidateQueries({ queryKey: ['order'] });
        void queryClient.invalidateQueries({ queryKey: ['assignments'] });
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
        void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
      };
      // The end-of-day reminder opens its sheet; everything else just refreshes.
      type Response = { notification: { request: { content: { data?: Record<string, unknown> } } } } | null;
      const kindOf = (r: Response) => r?.notification.request.content.data?.kind;
      const route = (r: Response) => {
        if (kindOf(r) === 'shift_end_check') shiftPrompt.open();
      };
      subs.push(Notifications.addNotificationReceivedListener(invalidate));
      subs.push(
        Notifications.addNotificationResponseReceivedListener((response) => {
          invalidate();
          route(response);
        }),
      );
      // A tap that launched the app arrives before any listener existed.
      void Notifications.getLastNotificationResponseAsync().then(route);
    });
    return () => subs.forEach((s) => s.remove());
  }, []);
}
