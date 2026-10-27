import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageArgs(q: PageQuery) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function toPage<T>(items: T[], total: number, q: PageQuery): Page<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Empty strings from query strings become undefined. */
export const optionalQueryString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));
