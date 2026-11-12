import { useQuery } from '@tanstack/react-query';
import { MAX_PAGE_SIZE, type UserPublic } from '@bigant/shared';
import { api } from './api';

/** Every seller account — for staff pickers (client owner, order filters). */
export function useSellers(enabled = true) {
  return useQuery({
    queryKey: ['users', 'seller'],
    queryFn: () => api.get<UserPublic[]>(`/users?role=seller&take=${MAX_PAGE_SIZE}`),
    enabled,
  });
}
