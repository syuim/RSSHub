import { destr } from 'destr';

import ofetch from '@/utils/ofetch';

import { getSearchParamsString } from './helpers';

const DEFAULT_PROXY = 'https://proxy.laoz.org/url?url=';

const buildProxyUrl = (targetUrl: string | URL, proxyBase = DEFAULT_PROXY): string => {
    const target = typeof targetUrl === 'string' ? targetUrl : targetUrl.href;
    const encoded = encodeURIComponent(target);

    if (proxyBase.endsWith('=') || proxyBase.endsWith('&') || proxyBase.endsWith('?')) {
        return `${proxyBase}${encoded}`;
    }

    const separator = proxyBase.includes('?') ? '&' : '?';
    return `${proxyBase}${separator}url=${encoded}`;
};

const getFakeGot = (defaultOptions?: any) => {
    const fakeGot = async (request, options?: any) => {
        if (!(typeof request === 'string' || request instanceof Request) && request.url) {
            options = {
                ...request,
                ...options,
            };
            request = request.url;
        }
        if (options?.hooks?.beforeRequest) {
            for (const hook of options.hooks.beforeRequest) {
                hook(options);
            }
            delete options.hooks;
        }

        options = {
            ...defaultOptions,
            ...options,
        };

        if (options?.json && !options.body) {
            options.body = options.json;
            delete options.json;
        }
        if (options?.form && !options.body) {
            options.body = new URLSearchParams(options.form as Record<string, string>).toString();
            if (!options.headers) {
                options.headers = {};
            }
            options.headers['content-type'] = 'application/x-www-form-urlencoded';
            delete options.form;
        }
        if (options?.searchParams) {
            request += '?' + getSearchParamsString(options.searchParams);
            delete options.searchParams;
        }

        // 保存 parseResponse 后移除，由 ofetch.raw 返回原始 body 后手动处理
        const parseResponse = options.parseResponse;
        delete options.parseResponse;

        if (options?.responseType === 'buffer' || options?.responseType === 'arrayBuffer') {
            options.responseType = 'arrayBuffer';
        }

        if (options.cookieJar) {
            const cookies = options.cookieJar.getCookiesSync(request);
            if (cookies.length) {
                if (!options.headers) {
                    options.headers = {};
                }
                options.headers.cookie = cookies.join('; ');
            }
            delete options.cookieJar;
        }

        const originalUrl = request;
        let useProxy = false;
        try {
            request = buildProxyUrl(request);
            useProxy = true;
        } catch {
            // 构建代理 URL 失败，保持原 URL
        }

        let raw;
        try {
            raw = await ofetch.raw(request, options);
            if (useProxy && raw.status >= 400) {
                throw new Error(`proxy ${raw.status}`);
            }
        } catch (error) {
            if (!useProxy) {
                throw error;
            }
            // 代理失败，回退直连
            request = originalUrl;
            raw = await ofetch.raw(request, options);
        }

        if (options?.responseType === 'arrayBuffer') {
            return {
                data: Buffer.from(raw._data),
                body: Buffer.from(raw._data),
            };
        }

        if (parseResponse) {
            return parseResponse(raw._data);
        }
        return { data: destr(raw._data), body: raw._data };
    };

    fakeGot.get = (request, options?) => fakeGot(request, { ...options, method: 'GET' });
    fakeGot.post = (request, options?) => fakeGot(request, { ...options, method: 'POST' });
    fakeGot.put = (request, options?) => fakeGot(request, { ...options, method: 'PUT' });
    fakeGot.patch = (request, options?) => fakeGot(request, { ...options, method: 'PATCH' });
    fakeGot.head = (request, options?) => fakeGot(request, { ...options, method: 'HEAD' });
    fakeGot.delete = (request, options?) => fakeGot(request, { ...options, method: 'DELETE' });
    fakeGot.extend = (options) => getFakeGot(options);

    return fakeGot;
};

export default getFakeGot();
