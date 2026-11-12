import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Refetch when the operator returns to the tab. This is what makes the slow
      // fallback intervals safe: the common "looked away, looked back" case
      // refreshes instantly instead of waiting out a poll.
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
});
