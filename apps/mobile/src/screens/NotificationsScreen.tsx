import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useBottomInset } from '../lib/useBottomInset';
import { ScreenHeader } from '../components/ScreenHeader';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { NotificationPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { formatDateTime } from '../lib/format';
import { EmptyState, Spinner } from '../components/ui';
import { colors } from '../components/theme';
import type { RootStackParams } from '../navigation/RootNavigator';
import { shiftPrompt } from '../lib/shiftPrompt';

type Nav = NativeStackNavigationProp<RootStackParams>;

export function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const nav = useNavigation<Nav>();

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<NotificationPublic[]>('/notifications'),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  function openItem(n: NotificationPublic) {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.related_order_id) nav.navigate('OrderDetail', { id: n.related_order_id });
    else if (n.type === 'shift_end_check') {
      nav.popToTop();
      shiftPrompt.open();
    } else if (n.type.startsWith('service_')) nav.popToTop();
  }

  const bottomInset = useBottomInset();
  return (
    <View style={[s.safe, { paddingBottom: bottomInset }]}>
      <ScreenHeader title={t('notifications.title')} />

      {isLoading ? (
        <Spinner />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => {
            // Translate by notification type; fall back to the stored (English) text.
            const titleKey = `notificationType.${item.type}.title`;
            const bodyKey = `notificationType.${item.type}.body`;
            const title = i18n.exists(titleKey) ? t(titleKey) : item.title;
            const body = i18n.exists(bodyKey) ? t(bodyKey, { client: item.client_name ?? t('home.clientLabel') }) : item.body;
            return (
              <Pressable onPress={() => openItem(item)} style={s.notifCard}>
                <View style={[s.dot, item.read_at ? s.dotRead : s.dotUnread]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.notifTitle}>{title}</Text>
                  <Text style={s.notifBody}>{body}</Text>
                  <Text style={s.notifTime}>{formatDateTime(item.created_at)}</Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={<EmptyState title={t('notifications.empty')} />}
          contentContainerStyle={{ paddingBottom: 24 }}
          onRefresh={refetch}
          refreshing={false}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  notifCard: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.mist,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dot: { marginTop: 5, width: 8, height: 8, borderRadius: 4 },
  dotUnread: { backgroundColor: colors.brand },
  dotRead: { backgroundColor: 'transparent' },
  notifTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  notifBody: { fontSize: 14, color: colors.slate },
  notifTime: { marginTop: 2, fontSize: 11, fontFamily: 'monospace', color: colors.slateLt },
});
