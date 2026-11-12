import { FlatList } from 'react-native';
import { useBottomInset } from '../lib/useBottomInset';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { OrderPublic } from '@bigant/shared';
import { api } from '../lib/api';
import { EmptyState, Spinner } from './ui';
import { OrderRow } from './OrderRow';
import type { RootStackParams } from '../navigation/RootNavigator';
import { isOrderActionLocked, useOrderActivationClock } from '../hooks/useOrderActivationClock';

type Nav = NativeStackNavigationProp<RootStackParams>;

/** A driver order list for one tab: fetches `url`, optionally filters client-side,
 *  renders order cards that open OrderDetail. Pull-to-refresh included. */
export function OrderList({
  queryKey,
  url,
  filter,
  emptyTitle,
  emptyHint,
}: {
  queryKey: unknown[];
  url: string;
  filter?: (all: OrderPublic[]) => OrderPublic[];
  emptyTitle: string;
  emptyHint?: string;
}) {
  const bottomInset = useBottomInset();
  const nav = useNavigation<Nav>();
  const { data = [], isLoading, refetch } = useQuery({
    queryKey,
    queryFn: () => api.get<OrderPublic[]>(url),
    select: filter,
    refetchInterval: 15_000,
  });
  const now = useOrderActivationClock(data);

  if (isLoading) return <Spinner />;

  return (
    <FlatList
      data={data}
      keyExtractor={(o) => o.id}
      renderItem={({ item }) => {
        const locked = isOrderActionLocked(item, now);
        return (
          <OrderRow
            order={item}
            disabled={locked}
            onPress={() => nav.navigate('OrderDetail', { id: item.id })}
          />
        );
      }}
      ListEmptyComponent={<EmptyState title={emptyTitle} hint={emptyHint} />}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 + bottomInset }}
      onRefresh={refetch}
      refreshing={false}
    />
  );
}

