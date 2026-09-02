import type { MiddlewareHandler } from 'hono';
import xxhash from 'xxhash-wasm';

import { config } from '@/config';
import RequestInProgressError from '@/errors/types/request-in-progress';
import type { Data } from '@/types';
import cacheModule from '@/utils/cache/index';
import { isWorker } from '@/utils/is-worker';
import logger from '@/utils/logger';

const bypassList = new Set(['/', '/robots.txt', '/logo.png', '/favicon.ico']);

// 永久缓存 TTL（365 天）
const PERMANENT_TTL = 365 * 24 * 60 * 60;

// 异步刷新配置
const ASYNC_REFRESH_TIMEOUT = 60000;
const ASYNC_REFRESH_RETRIES = 5;
const REFRESH_LOCK_TTL = 30; // 刷新锁 TTL（秒），防止并发刷新

const REFRESH_LOCK_PREFIX = 'rsshub:refresh-lock:';

const { h64ToString } = await xxhash();

async function triggerAsyncRefresh(requestUrl: string) {
    if (isWorker) {
        return;
    }

    const { port } = config.connect;
    const u = new URL(requestUrl);
    u.protocol = 'http:';
    u.hostname = '127.0.0.1';
    u.port = String(port);
    u.searchParams.set('_cache_bypass', '1');

    const refreshUrl = u.href;

    for (let attempt = 1; attempt <= ASYNC_REFRESH_RETRIES; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), ASYNC_REFRESH_TIMEOUT);
            // eslint-disable-next-line no-await-in-loop
            const res = await fetch(refreshUrl, { signal: controller.signal });
            clearTimeout(timer);

            if (res.ok) {
                logger.info(`Async cache refresh succeeded for ${requestUrl}`);
                return;
            }
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        } catch (error: any) {
            logger.error(`Async cache refresh attempt ${attempt}/${ASYNC_REFRESH_RETRIES} failed for ${u.pathname}: ${error.message}`);
            if (attempt < ASYNC_REFRESH_RETRIES) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** (attempt - 1), 30000)));
            }
        }
    }
    logger.error(`Async cache refresh exhausted ${ASYNC_REFRESH_RETRIES} retries for ${u.pathname}`);
}

const middleware: MiddlewareHandler = async (ctx, next) => {
    if (!cacheModule.status.available || bypassList.has(ctx.req.path)) {
        await next();
        return;
    }

    const requestPath = ctx.req.path;
    const format = `:${ctx.req.query('format') || config.format}`;
    const limit = ctx.req.query('limit') ? `:${ctx.req.query('limit')}` : '';
    const key = 'rsshub:koa-redis-cache:' + h64ToString(requestPath + format + limit);
    const controlKey = 'rsshub:path-requested:' + h64ToString(requestPath + format + limit);

    // _cache_bypass 用于异步刷新：不读缓存，但正常写缓存
    const isBypass = ctx.req.query('_cache_bypass') === '1';

    if (!isBypass) {
        const cached = await cacheModule.globalCache.get(key);
        if (cached) {
            // 命中缓存 → 直接返回
            ctx.status(200);
            ctx.header('RSSHub-Cache-Status', 'HIT');
            ctx.set('data', JSON.parse(cached));
            await next();

            // 尝试获取刷新锁，避免并发刷新
            const refreshLockKey = REFRESH_LOCK_PREFIX + h64ToString(requestPath + format + limit);
            const claimed = await cacheModule.globalCache.claim(refreshLockKey, REFRESH_LOCK_TTL);
            if (claimed) {
                const fullUrl = ctx.req.url; // 原始请求 URL，含 query
                triggerAsyncRefresh(fullUrl);
            }
            return;
        }
    }

    // 未命中（或 bypass）→ 取源
    let isRequesting = false;
    if (!isBypass) {
        isRequesting = !(await cacheModule.globalCache.claim(controlKey, config.cache.requestTimeout));
    }

    if (isRequesting) {
        let retryTimes = process.env.NODE_ENV === 'test' ? 1 : 10;
        let bypass = false;
        while (retryTimes > 0) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === 'test' ? 3000 : 6000));
            // eslint-disable-next-line no-await-in-loop
            if ((await cacheModule.globalCache.get(controlKey)) !== '1') {
                bypass = true;
                break;
            }
            retryTimes--;
        }
        if (!bypass) {
            throw new RequestInProgressError('This path is currently fetching, please come back later!');
        }
        const value = await cacheModule.globalCache.get(key);
        if (value) {
            ctx.status(200);
            ctx.header('RSSHub-Cache-Status', 'HIT');
            ctx.set('data', JSON.parse(value));
            await next();
            return;
        }
    }

    if (isRequesting) {
        await cacheModule.globalCache.set(controlKey, '1', config.cache.requestTimeout);
    }

    ctx.set('cacheKey', key);
    ctx.set('cacheControlKey', controlKey);

    try {
        await next();
    } catch (error) {
        await cacheModule.globalCache.set(controlKey, '0', config.cache.requestTimeout);
        throw error;
    }

    const data: Data = ctx.get('data');
    if (ctx.res.headers.get('Cache-Control') !== 'no-cache' && data) {
        if (isBypass && (!data.item || data.item.length === 0)) {
            logger.warn(`Async refresh: skip caching empty result for ${requestPath}`);
        } else {
            data.lastBuildDate = new Date().toUTCString();
            ctx.set('data', data);
            const body = JSON.stringify(data);
            await cacheModule.globalCache.set(key, body, PERMANENT_TTL);
        }
    }

    await cacheModule.globalCache.set(controlKey, '0', config.cache.requestTimeout);
};

export default middleware;
