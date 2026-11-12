import { useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AssignmentPublic,
  OrderExceptionInput,
  OrderPublic,
  OrderReturnInput,
} from '@bigant/shared';
import { api } from '../lib/api';
import { queryClient } from '../lib/queryClient';

/** All driver actions on one order: accept/reject the assignment, then the
 *  place-based journey (depart/arrive each pickup → depart/arrive customer →
 *  deliver). Every mutation refreshes the order, lists and driver status. */
export function useOrderJourney(order: OrderPublic) {
  const id = order.id;

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['order', id] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['assignments'] });
    void queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
  }, [id]);

  const assignmentsQ = useQuery({
    queryKey: ['assignments', 'mine'],
    queryFn: () => api.get<AssignmentPublic[]>('/assignments/mine'),
    enabled: order.status === 'assigned_to_driver',
    // This list is the only thing standing between the driver and the Accept
    // button, so a dropped connection keeps trying instead of leaving an
    // empty screen over a job he was given.
    retry: 3,
    refetchInterval: (q) => (q.state.error ? 5000 : false),
  });
  const pendingAssignment = assignmentsQ.data?.find(
    (a) => a.order_id === id && a.assignment_status === 'pending_driver_response',
  );

  const acceptM = useMutation({
    mutationFn: () => api.post(`/assignments/${pendingAssignment!.id}/accept`),
    onSuccess: invalidate,
  });
  const rejectM = useMutation({
    mutationFn: () => api.post(`/assignments/${pendingAssignment!.id}/reject`),
    onSuccess: invalidate,
  });
  const departPickupM = useMutation({
    mutationFn: (pickupId: string) => api.patch(`/orders/${id}/pickups/${pickupId}/depart`),
    onSuccess: invalidate,
  });
  const arrivePickupM = useMutation({
    mutationFn: ({ pickupId, photoUrl, comment }: { pickupId: string; photoUrl: string; comment: string | null }) =>
      api.patch(`/orders/${id}/pickups/${pickupId}/arrive`, { photo_url: photoUrl, comment }),
    onSuccess: invalidate,
  });
  const departCustomerM = useMutation({
    mutationFn: () => api.patch(`/orders/${id}/depart-to-customer`),
    onSuccess: invalidate,
  });
  const arriveCustomerM = useMutation({
    mutationFn: () => api.patch(`/orders/${id}/arrive-at-customer`),
    onSuccess: invalidate,
  });
  const deliverM = useMutation({
    mutationFn: ({ photoUrl, comment }: { photoUrl: string; comment: string | null }) =>
      api.patch(`/orders/${id}/deliver`, { photo_url: photoUrl, comment }),
    onSuccess: invalidate,
  });
  const exceptionM = useMutation({
    mutationFn: (input: OrderExceptionInput) => api.patch(`/orders/${id}/exception`, input),
    onSuccess: invalidate,
  });
  const startReturnM = useMutation({
    mutationFn: (input: OrderReturnInput) => api.patch(`/orders/${id}/return`, input),
    onSuccess: invalidate,
  });
  const departReturnM = useMutation({
    mutationFn: (pickupId: string) => api.patch(`/orders/${id}/return/pickups/${pickupId}/depart`),
    onSuccess: invalidate,
  });
  // Ojidaniya: the return is set aside so the next order comes first.
  const deferReturnM = useMutation({
    mutationFn: () => api.patch(`/orders/${id}/return/defer`),
    onSuccess: invalidate,
  });
  const arriveReturnM = useMutation({
    mutationFn: (pickupId: string) => api.patch(`/orders/${id}/return/pickups/${pickupId}/arrive`),
    onSuccess: invalidate,
  });
  const completeReturnM = useMutation({
    mutationFn: ({ pickupId, photoUrl, comment }: { pickupId: string; photoUrl: string; comment: string | null }) =>
      api.patch(`/orders/${id}/return/pickups/${pickupId}/complete`, { photo_url: photoUrl, comment }),
    onSuccess: invalidate,
  });

  const pending =
    acceptM.isPending ||
    rejectM.isPending ||
    departPickupM.isPending ||
    arrivePickupM.isPending ||
    departCustomerM.isPending ||
    arriveCustomerM.isPending ||
    deliverM.isPending ||
    exceptionM.isPending ||
    startReturnM.isPending ||
    departReturnM.isPending ||
    deferReturnM.isPending ||
    arriveReturnM.isPending ||
    completeReturnM.isPending;

  return {
    pendingAssignment,
    assignmentsQ,
    acceptM,
    rejectM,
    departPickupM,
    arrivePickupM,
    departCustomerM,
    arriveCustomerM,
    deliverM,
    exceptionM,
    startReturnM,
    departReturnM,
    deferReturnM,
    arriveReturnM,
    completeReturnM,
    pending,
    invalidate,
  };
}
