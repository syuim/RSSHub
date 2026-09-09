import path from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { config } from '@/config';
import type { DevRegistry } from '@/registry-dev';
import type { NamespacesType, RoutesType } from '@/registry-helpers';
import { registerApiRoutes, registerRssRoutes } from '@/registry-helpers';
import type { LazyRegistry } from '@/registry-lazy';
import healthz from '@/routes/healthz';
import index from '@/routes/index';
import robotstxt from '@/routes/robots.txt';
import type { Route } from '@/types';
import { isWorker } from '@/utils/is-worker';

export type { NamespacesType } from '@/registry-helpers';
export { collectNamespaceRoots, resolveModuleNamespace, sortRoutes } from '@/registry-helpers';

const __dirname = import.meta.dirname;

function isSafeRoutes(routes: RoutesType): boolean {
    return Object.values(routes).every((route: Route) => !route.features?.nsfw);
}

function safeNamespaces(namespaces: NamespacesType): NamespacesType {
    const safe: NamespacesType = {};

    for (const [key, value] of Object.entries(namespaces)) {
        if (value.routes === null || value.routes === undefined || isSafeRoutes(value.routes)) {
            safe[key] = value;
        }
    }
    return safe;
}

let namespaces: NamespacesType = {};
let devRegistry: DevRegistry | undefined;
let lazyRegistry: LazyRegistry | undefined;

if (config.isPackage) {
    // @ts-ignore build artifact of pnpm build:routes
    namespaces = (await import('../assets/build/routes.js')).default;
} else if (!isWorker && !process.env.VERCEL_ENV && process.env.NODE_ENV === 'production') {
    // lazy load production namespaces: only the lightweight index is imported at startup
    const { createLazyRegistry } = await import('@/registry-lazy');
    lazyRegistry = await createLazyRegistry(namespaces);
} else {
    switch (process.env.NODE_ENV || process.env.VERCEL_ENV) {
        case 'production':
            // @ts-ignore build artifact of pnpm build:routes
            namespaces = (await import('../assets/build/routes.js')).default;
            break;
        case 'test':
            // @ts-expect-error TS2322 the JSON module's inferred literal type is narrower than NamespacesType
            namespaces = await import('../assets/build/routes.json');
            if (namespaces.default) {
                // @ts-expect-error TS2322 the JSON module's default export does not satisfy NamespacesType
                namespaces = namespaces.default;
            }
            break;
        default: {
            // lazy load dev namespaces
            const { createDevRegistry } = await import('@/registry-dev');
            devRegistry = createDevRegistry({
                routesDirectory: path.join(__dirname, './routes'),
                namespaces,
            });
        }
    }
}

// Lazy registries filter nothing upfront (matching dev behavior); disable_nsfw applies to full loads only
if (config.feature.disable_nsfw && !devRegistry && !lazyRegistry) {
    namespaces = safeNamespaces(namespaces);
}

export const ensureAllLoaded: () => Promise<void> = lazyRegistry?.ensureAllLoaded ?? devRegistry?.ensureAllLoaded ?? (() => Promise.resolve());

export { namespaces };

const app = new Hono();

if (!devRegistry && !lazyRegistry) {
    registerRssRoutes(app, namespaces);
    registerApiRoutes(app, namespaces);
}

app.get('/', index);
app.get('/healthz', healthz);
app.get('/robots.txt', robotstxt);
if (config.debugInfo !== 'false') {
    // Only enable tracing in debug mode; load the OpenTelemetry metrics module on first request
    app.get('/metrics', async (ctx, next) => (await import('@/routes/metrics')).default(ctx, next));
}

if (lazyRegistry) {
    app.use('*', lazyRegistry.middleware);
} else if (devRegistry) {
    app.use('*', devRegistry.middleware);
}

if (!config.isPackage && !process.env.VERCEL_ENV && !isWorker) {
    app.use(
        '/*',
        serveStatic({
            root: path.join(__dirname, 'assets'),
            rewriteRequestPath: (path) => (path === '/favicon.ico' ? '/favicon.png' : path),
        })
    );
}

export default app;
