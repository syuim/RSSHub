import type { MiddlewareHandler } from 'hono';

// 路径黑名单：命中即以 404 直接返回，不进入路由与缓存
// 需要屏蔽新路径时，往数组追加一项即可（如 '/t66y'）
const blockedKeywords = ['/weibo'];

const middleware: MiddlewareHandler = async (ctx, next) => {
    const requestPath = ctx.req.path;
    if (blockedKeywords.some((keyword) => requestPath.startsWith(keyword))) {
        ctx.status(404);
        return ctx.text('404 Not Found');
    }
    await next();
};

export default middleware;
