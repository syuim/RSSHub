import type { MiddlewareHandler } from 'hono';

import { config } from '@/config';
import { getPath } from '@/utils/helpers';
import type { tracer as Tracer } from '@/utils/otel';

let tracer: typeof Tracer | undefined;

const middleware: MiddlewareHandler = async (ctx, next) => {
    if (config.debugInfo === 'false') {
        // Skip
        await next();
    } else {
        // Only enable tracing in debug mode (matches /metrics mounting semantics; a raw truthiness
        // check would treat the 'false' env value as enabled)
        const { method, raw } = ctx.req;
        const path = getPath(raw);

        const activeTracer = (tracer ??= (await import('@/utils/otel')).tracer);
        const span = activeTracer.startSpan(`${method} ${path}`, {
            kind: 1, // server
            attributes: {},
        });
        span.addEvent('invoking handleRequest');
        await next();
        span.end();
    }
};

export default middleware;
