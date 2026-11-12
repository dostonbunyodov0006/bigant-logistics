import { bootMark } from '../lib/bootTrace';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { DriverHomeScreen } from '../screens/DriverHomeScreen';
import { OrderDetailScreen } from '../screens/OrderDetailScreen';
import { LeaveScreen } from '../screens/LeaveScreen';
import { DocumentsScreen } from '../screens/DocumentsScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { FuelTypeScreen } from '../screens/fuel/FuelTypeScreen';
import { FuelPickerScreen } from '../screens/fuel/FuelPickerScreen';
import { FuelStationScreen } from '../screens/fuel/FuelStationScreen';
import { FuelReviewScreen } from '../screens/fuel/FuelReviewScreen';
import { FuelDoneScreen } from '../screens/fuel/FuelDoneScreen';
import { FuelOdometerScreen } from '../screens/fuel/FuelOdometerScreen';
import { ServiceReasonsScreen } from '../screens/service/ServiceReasonsScreen';
import { ServicePickerScreen } from '../screens/service/ServicePickerScreen';
import { ServiceCenterScreen } from '../screens/service/ServiceCenterScreen';
import { ServicePhotosScreen } from '../screens/service/ServicePhotosScreen';
import { ServiceCostScreen } from '../screens/service/ServiceCostScreen';
import { ServiceDoneScreen } from '../screens/service/ServiceDoneScreen';
import { ShiftCarryOverScreen } from '../screens/shift/ShiftCarryOverScreen';
import { ShiftCarryDoneScreen } from '../screens/shift/ShiftCarryDoneScreen';
import { VozvratScreen } from '../screens/vozvrat/VozvratScreen';
import type { CarryOverReason, FuelLog, FuelStation, FuelType, OrderInHand, ServiceCenter, ServiceVisit, WorkLogPublic } from '@bigant/shared';
import type { FuelShot } from '../hooks/useFuelPhoto';
import type { Work } from '../lib/service';
import { colors, isDarkTheme } from '../components/theme';

/**
 * The frame around the screens: what shows between them while one slides over
 * another, and behind a screen that does not fill the phone. Without this the
 * dark app flashes white at every push.
 */
const navTheme = {
  ...(isDarkTheme ? DarkTheme : DefaultTheme),
  colors: {
    ...(isDarkTheme ? DarkTheme : DefaultTheme).colors,
    background: colors.paper,
    card: colors.white,
    text: colors.ink,
    border: colors.mist,
    primary: colors.brand,
  },
};

export type RootStackParams = {
  DriverHome: undefined;
  // takeReturn: opened from "Vozvrat qilinadigan yuk bor" — he came to take it back, so no Ojidaniya.
  OrderDetail: { id: string; takeReturn?: boolean };
  Leave: undefined;
  Documents: undefined;
  Notifications: undefined;
  // The fuel log, one screen per step so the native back button walks it.
  FuelType: undefined;
  FuelPicker: { fuelType: FuelType };
  FuelStation: { fuelType: FuelType; station: FuelStation; distanceM: number | null; auto?: boolean };
  FuelReview: { fuelType: FuelType; station: FuelStation | null; shot: FuelShot };
  FuelDone: { log: FuelLog };
  // Every Monday, right after "Ishni boshladim": the odometer, photographed and typed.
  FuelOdometer: { lastKm: number | null; shiftStartedAt?: string | null };
  // The service visit: reasons, then the centre. The picker and centre screens
  // serve both a new emergency (works in hand) and an approved request (visit
  // id in hand).
  ServiceReasons: { preselect?: string[] } | undefined;
  ServicePicker: { works?: Work[]; visitId?: string };
  ServiceCenter: { works?: Work[]; visitId?: string; center: ServiceCenter; distanceM: number | null };
  ServicePhotos: { visitId: string };
  ServiceCost: { visitId: string };
  ServiceDone: { visit: ServiceVisit };
  // Ending the shift with orders in hand: "not today" — why, then done.
  ShiftCarryOver: { orders: OrderInHand[]; via: 'toggle' | 'stop' };
  ShiftCarryDone: { log: WorkLogPublic; orders: OrderInHand[]; reason: CarryOverReason; comment: string | null };
  // Starting a vozvrat at the client: the returned products, then where each load goes.
  Vozvrat: { orderId: string };
};

/**
 * Pushed screens draw their own header (ScreenHeader) so the status-bar and
 * navigation-bar insets are handled by one piece of code on every screen.
 */
const pushed = { headerShown: false } as const;

const Stack = createNativeStackNavigator<RootStackParams>();

function ConnectingScreen() {
  const { retryNow, useOtherAccount } = useAuth();
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.white, gap: 16 }}>
      <ActivityIndicator size="large" color={colors.brand} />
      <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink, textAlign: 'center' }}>{t('login.connecting')}</Text>
      <Text style={{ fontSize: 14, color: colors.slate, textAlign: 'center' }}>{t('login.connectingHint')}</Text>
      <Pressable
        onPress={retryNow}
        accessibilityRole="button"
        style={{ marginTop: 8, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14, backgroundColor: colors.brand }}
      >
        <Text style={{ fontSize: 16, fontWeight: '800', color: '#ffffff' }}>{t('common.retry')}</Text>
      </Pressable>
      <Pressable onPress={useOtherAccount} accessibilityRole="button" style={{ padding: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.slate }}>{t('login.otherAccount')}</Text>
      </Pressable>
    </View>
  );
}

function AuthStack() {
  return <LoginScreen />;
}

export function RootNavigator() {
  const { user, ready, reconnecting } = useAuth();
  // The end of the start: the first screen past the spinner is on.
  useEffect(() => {
    if (ready) bootMark('ready');
  }, [ready]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  // A saved session still being confirmed: "connecting", not the login form
  // (owner, 09.11.2026).
  if (!user && reconnecting) return <ConnectingScreen />;

  if (!user) {
    return (
      <NavigationContainer theme={navTheme}>
        <AuthStack />
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="DriverHome" component={DriverHomeScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={pushed} />
        <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={pushed} />
        <Stack.Screen name="Leave" component={LeaveScreen} options={pushed} />
        <Stack.Screen name="Documents" component={DocumentsScreen} options={pushed} />
        <Stack.Screen name="FuelType" component={FuelTypeScreen} options={pushed} />
        <Stack.Screen name="FuelPicker" component={FuelPickerScreen} options={pushed} />
        <Stack.Screen name="FuelStation" component={FuelStationScreen} options={pushed} />
        <Stack.Screen name="FuelReview" component={FuelReviewScreen} options={pushed} />
        <Stack.Screen name="FuelDone" component={FuelDoneScreen} options={pushed} />
        <Stack.Screen name="FuelOdometer" component={FuelOdometerScreen} options={pushed} />
        <Stack.Screen name="ServiceReasons" component={ServiceReasonsScreen} options={pushed} />
        <Stack.Screen name="ServicePicker" component={ServicePickerScreen} options={pushed} />
        <Stack.Screen name="ServiceCenter" component={ServiceCenterScreen} options={pushed} />
        <Stack.Screen name="ServicePhotos" component={ServicePhotosScreen} options={pushed} />
        <Stack.Screen name="ServiceCost" component={ServiceCostScreen} options={pushed} />
        <Stack.Screen name="ServiceDone" component={ServiceDoneScreen} options={pushed} />
        <Stack.Screen name="ShiftCarryOver" component={ShiftCarryOverScreen} options={pushed} />
        <Stack.Screen name="ShiftCarryDone" component={ShiftCarryDoneScreen} options={pushed} />
        <Stack.Screen name="Vozvrat" component={VozvratScreen} options={pushed} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
