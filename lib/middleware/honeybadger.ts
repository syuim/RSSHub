import type HoneybadgerType from '@honeybadger-io/js';
import type { MiddlewareHandler } from 'hono';

import { config } from '@/config';
import { getRouteNameFromPath } from '@/utils/helpers';
import logger from '@/utils/logger';

let Honeybadger: typeof HoneybadgerType | undefined;

if (config.honeybadger.apiKey) {
    Honeybadger = (await import('@honeybadger-io/js')).default;
    Honeybadger.configure({
        apiKey: config.honeybadger.apiKey,
        enableUncaught: false,
    });
    Honeybadger.setContext({ node_name: config.nodeName });

    logger.info('Honeybadger inited.');
}

const middleware: MiddlewareHandler = async (ctx, next) => {
    const time = Date.now();
    await next();
    if (Honeybadger && Date.now() - time >= config.errorTrackingRouteTimeout) {
        Honeybadger.notify(new Error('Route Timeout'), {
            context: { name: getRouteNameFromPath(ctx.req.path) },
        });
    }
};

export default middleware;
