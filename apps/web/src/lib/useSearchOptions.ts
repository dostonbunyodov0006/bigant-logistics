import { useQuery } from '@tanstack/react-query';
import { MAX_PAGE_SIZE } from '@bigant/shared';
import { api } from './api';
import { useDebouncedValue } from './useDebouncedValue';

/**
 * Options for a picker that may have more rows than one page: what was typed
 * is searched on the server, so the 101st client or the 51st lorry can still
 * be found (owner, 29.10.2026). The row already chosen stays in the list even
 * when the search no longer matches it, so the form never loses it.
 */
export function useSearchOptions<T extends { id: string }>(
  path: '/clients' | '/vehicles',
  search: string,
  selectedId: string,
  enabled = true,
) {
  const q = useDebouncedValue(search.trim(), 250);
  const listQ = useQuery({
    queryKey: [path.slice(1), 'pick', q],
    queryFn: () =>
      api.get<T[]>(`${path}?take=${MAX_PAGE_SIZE}${q ? `&search=${encodeURIComponent(q)}` : ''}`),
    placeholderData: (prev) => prev,
    enabled,
  });
  const missing = !!selectedId && !!listQ.data && !listQ.data.some((r) => r.id === selectedId);
  const selectedQ = useQuery({
    queryKey: [path.slice(1, -1), selectedId],
    queryFn: () => api.get<T>(`${path}/${selectedId}`),
    enabled: enabled && missing,
  });
  const rows = listQ.data ?? [];
  const data = missing && selectedQ.data ? [selectedQ.data, ...rows] : rows;
  return { data, isLoading: listQ.isLoading };
}
