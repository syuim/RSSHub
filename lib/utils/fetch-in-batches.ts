import pMap from 'p-map';

import cache from '@/utils/cache';
import wait from '@/utils/wait';

type BatchedFetchOptions = {
    /** batch size and per-batch concurrency, default 10 */
    concurrency?: number;
    /** cooling interval between batches in ms, default 2000 */
    batchInterval?: number;
};

/**
 * Cache-aware batched fetch: items already cached are returned from cache,
 * the rest are fetched in batches with a cooling interval between batches.
 * Useful for anti-crawler sites that rate-limit concurrent requests (429).
 */
export default async function fetchInBatches<T extends { link?: string }>(items: T[], fetcher: (item: T) => Promise<T>, { concurrency = 10, batchInterval = 2000 }: BatchedFetchOptions = {}) {
    const results: T[] = [];
    // sequential batches with cooling interval are the point of this helper
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        // eslint-disable-next-line no-await-in-loop
        results.push(...(await pMap(batch, (item) => cache.tryGet(item.link!, () => fetcher(item)), { concurrency })));
        if (i + concurrency < items.length) {
            // eslint-disable-next-line no-await-in-loop
            await wait(batchInterval);
        }
    }
    return results;
}
