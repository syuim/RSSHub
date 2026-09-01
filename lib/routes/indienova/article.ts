import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';

import { parseItem, parseList } from './utils';

export const route: Route = {
    path: '/:type',
    categories: ['game'],
    example: '/indienova/article',
    parameters: { type: '类型: `article` 文章，`development` 开发' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '文章',
    maintainers: ['GensouSakuya', 'kt286'],
    handler,
};

async function handler(ctx) {
    const type = ctx.req.param('type');
    let link = 'https://indienova.com/indie-game-news/';
    if (type === 'development') {
        link = 'https://indienova.com/indie-game-development/';
    }
    const response = await got(link);

    const $ = load(response.data);
    const list = parseList($);

    const items: DataItem[] = [];
    for (const item of list) {
        // eslint-disable-next-line no-await-in-loop
        const processed = await cache.tryGet(item.link, () => parseItem(item));
        items.push(processed);
    }

    return {
        title: $('head title').text(),
        link,
        description: '独立游戏资讯 | indienova 独立游戏',
        item: items,
    };
}
