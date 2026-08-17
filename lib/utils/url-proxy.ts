import { ofetch } from 'ofetch';
import type { FetchOptions } from 'ofetch';

/**
 * Build a proxied URL by prepending the target URL to a URL-rewriting proxy.
 *
 * Handles various proxy URL formats:
 * - `https://proxy.laoz.org/url?url=` → appends encoded target
 * - `https://proxy.laoz.org/fetch?`   → appends `url=<encoded target>`
 * - `https://proxy.laoz.org/`          → appends `?url=<encoded target>`
 */
export const buildProxyUrl = (proxyBase: string, targetUrl: string | URL): string => {
    const target = typeof targetUrl === 'string' ? targetUrl : targetUrl.href;
    const encoded = encodeURIComponent(target);

    if (proxyBase.endsWith('=') || proxyBase.endsWith('&') || proxyBase.endsWith('?')) {
        return `${proxyBase}${encoded}`;
    }

    const separator = proxyBase.includes('?') ? '&' : '?';
    return `${proxyBase}${separator}url=${encoded}`;
};

/**
 * Fetch a URL through a URL-rewriting proxy.
 *
 * @param proxyBase - The proxy base URL, e.g. `https://proxy.laoz.org/url?url=`
 * @param targetUrl - The actual target URL to fetch
 * @param options   - Additional fetch options passed to `ofetch`
 */
export const proxyFetch = <T = any>(proxyBase: string, targetUrl: string | URL, options?: FetchOptions<'json'>): Promise<T> => {
    const url = buildProxyUrl(proxyBase, targetUrl);
    return ofetch(url, options);
};