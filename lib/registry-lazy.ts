import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import type { NamespacesType } from '@/registry-helpers';
import { registerApiRoutes, registerRssRoutes } from '@/registry-helpers';

export type LazyRegistry = {
    middleware: MiddlewareHandler;
    ensureAllLoaded: () => Promise<void>;
};

type NamespaceMeta = NamespacesType[string];

/**
 * Production lazy route loading. The build emits one metadata chunk per namespace plus a lightweight
 * key -> loader index (`assets/build/routes-index.js`); this registry imports only the index at
 * startup and pulls in a namespace's metadata on its first request. Each top-level namespace gets
 * its own Hono sub-app (built lazily) since Hono freezes its router after the first match.
 */
export async function createLazyRegistry(namespaces: NamespacesType): Promise<LazyRegistry> {
    // @ts-ignore build artifact of pnpm build:routes
    const { default: index } = (await import('../assets/build/routes-index.js')) as { default: Record<string, () => Promise<{ default: NamespaceMeta }>> };
    const topKeys = new Set(Object.keys(index).map((key) => key.split('/', 1)[0]));
    const subApps = new Map<string, Promise<Hono>>();
    const outerContexts = new WeakMap<Request, Context>();

    const loadNamespace = async (key: string): Promise<void> => {
        const { default: meta } = await index[key]();
        namespaces[key] = Object.assign({ routes: {}, apiRoutes: {} }, namespaces[key], meta);
    };

    const ensureTopLevel = async (top: string): Promise<Hono> => {
        let promise = subApps.get(top);
        if (!promise) {
            promise = (async () => {
                const keys = Object.keys(index).filter((key) => key === top || key.startsWith(`${top}/`));
                await Promise.all(keys.map((key) => loadNamespace(key)));

                const subApp = new Hono();
                // Rethrow so handler errors reach the outer app's error handler instead of a bare 500
                subApp.onError((error) => {
                    throw error;
                });
                subApp.use('*', bridge);
                const subset = Object.fromEntries(Object.entries(namespaces).filter(([key]) => key === top || key.startsWith(`${top}/`)));
                registerRssRoutes(subApp, subset);
                registerApiRoutes(subApp, subset);
                return subApp;
            })();
            subApps.set(top, promise);
        }
        try {
            return await promise;
        } catch (error) {
            // Import errors are not memoized so a fixed file works on the next request
            subApps.delete(top);
            throw error;
        }
    };

    const bridge: MiddlewareHandler = async (ctx, next) => {
        const outer = outerContexts.get(ctx.req.raw);
        if (outer) {
            for (const [key, value] of Object.entries(outer.var)) {
                ctx.set(key as never, value as never);
            }
        }
        await next();
        if (outer) {
            for (const [key, value] of Object.entries(ctx.var)) {
                outer.set(key as never, value as never);
            }
        }
        if (!ctx.finalized && (ctx.get('data') || ctx.get('apiData'))) {
            // Data-producing handlers return undefined (the outer template middleware renders the
            // bridged vars); finalize so Hono does not raise "Context is not finalized".
            ctx.res = new Response(null, { status: 204 });
        }
    };

    const middleware: MiddlewareHandler = async (ctx, next) => {
        const segments = ctx.req.path.split('/').filter(Boolean);
        const candidate = segments[0] === 'api' ? segments[1] : segments[0];
        if (!candidate || !topKeys.has(candidate)) {
            return next();
        }
        const subApp = await ensureTopLevel(candidate);
        outerContexts.set(ctx.req.raw, ctx);
        try {
            const response = await subApp.fetch(ctx.req.raw);
            if (ctx.get('data') || ctx.get('apiData')) {
                // The upstream template middleware renders from the bridged vars
                return;
            }
            if (response.status === 404) {
                return next();
            }
            return response;
        } finally {
            outerContexts.delete(ctx.req.raw);
        }
    };

    const ensureAllLoaded = async (): Promise<void> => {
        // One big parse beats importing ~2000 tiny chunks: V8 per-module overhead would make the
        // full-load case slower and heavier than the classic eager mode. Merge the same module
        // instances (built from the same source), so lazy and full metadata stay consistent.
        // Sub-apps are still built per-top on first request by the middleware.
        const { default: full } = (await import('../assets/build/routes.js')) as { default: NamespacesType };
        for (const key in full) {
            namespaces[key] = full[key];
        }
    };

    return { middleware, ensureAllLoaded };
}
