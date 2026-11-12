import { z } from 'zod';

/**
 * Server-side pagination for list endpoints.
 *
 * The alternative these replace was a bare `take: 500` — which silently drops
 * everything past the cap, so a page looks complete when it isn't. A page plus
 * a total lets the caller see that more exists.
 */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

export const paginationSchema = z.object({
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

/** `{ items, total }` for any row schema — total is the full match count, not
 *  the page length, so the UI can render "page 3 of 12". */
export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), total: z.number().int() });
}

export interface Page<T> {
  items: T[];
  total: number;
}
