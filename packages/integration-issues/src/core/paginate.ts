import { TRACKER_FIRST_PAGE_NUMBER } from "../constants/http.js";

/** Fetch one page of a page-number paginated tracker listing. */
export type PageFetcher<Item> = (pageNumber: number) => Promise<Item[]>;

/**
 * Collect every item of a page-number paginated listing, in order.
 *
 * Pages are requested one after another until one comes back with fewer
 * than `pageSize` items. There is deliberately no page cap: a truncated
 * listing would make callers miss issues (status sync, `deleteAll`) or
 * comments (deletion idempotency) and act on stale data.
 *
 * @param fetchPage - Requests a page by its 1-based number; the provider owns the endpoint and query.
 * @param pageSize - Items requested per page, used to detect the last page.
 * @returns Every item across all pages.
 */
export async function collectAllPages<Item>(fetchPage: PageFetcher<Item>, pageSize: number): Promise<Item[]> {
  const items: Item[] = [];
  for (let pageNumber = TRACKER_FIRST_PAGE_NUMBER; ; pageNumber++) {
    const pageItems = await fetchPage(pageNumber);
    items.push(...pageItems);
    if (pageItems.length < pageSize) return items;
  }
}
