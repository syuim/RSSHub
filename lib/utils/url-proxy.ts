import type { FetchOptions } from 'ofetch';
import { ofetch } from 'ofetch';

const DEFAULT_URL_PROXY = 'https://proxy.laoz.org/url?url=';

/**
 * Build a proxied URL by prepending the target URL to a URL-rewriting proxy.
 *
 * Handles various proxy URL formats:
 * - `https://proxy.laoz.org/url?url=` → appends encoded target
 * - `https://proxy.laoz.org/fetch?`   → appends `url=<encoded target>`
 * - `https://proxy.laoz.org/`          → appends `?url=<encoded target>`
 */
export const buildProxyUrl = (targetUrl: string | URL, proxyBase: string = DEFAULT_URL_PROXY): string => {
    const target = typeof targetUrl === 'string' ? targetUrl : targetUrl.href;
    const encoded = encodeURIComponent(target);

    if (proxyBase.endsWith('=') || proxyBase.endsWith('&') || proxyBase.endsWith('?')) {
        return `${proxyBase}${encoded}`;
    }

    const separator = proxyBase.includes('?') ? '&' : '?';
    return `${proxyBase}${separator}url=${encoded}`;
};

/**
 * Fetch a URL through a URL-rewriting proxy. Defaults to the CF proxy at
 * `https://proxy.laoz.org/url?url=` when `proxyBase` is omitted.
 *
 * @param targetUrl - The actual target URL to fetch
 * @param options   - Additional fetch options passed to `ofetch`
 * @param proxyBase - The proxy base URL, e.g. `https://proxy.laoz.org/url?url=`
 */
export const proxyFetch = async <T = any>(targetUrl: string | URL, options?: FetchOptions<'json'>, proxyBase: string = DEFAULT_URL_PROXY): Promise<T> => {
    const target = typeof targetUrl === 'string' ? targetUrl : targetUrl.href;
    try {
        const url = buildProxyUrl(target, proxyBase);
        const res = await ofetch.raw<T>(url, options);
        if (res.status >= 400) {
            throw new Error(`proxy returned ${res.status}`);
        }
        return res._data as T;
    } catch {
        // Proxy 失败，回退直连（host IP 直连）
        return ofetch<T>(target, options);
    }
};
