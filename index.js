/**
 * cognitive-library — a local, plain-Markdown knowledge base for DSH.
 *
 * Registers:
 *   - tools: cognitive_save / cognitive_list / cognitive_search / cognitive_relate
 *            / cognitive_category / cognitive_reindex
 *   - skill: cognitive-library (the workflow the model follows)
 *
 * The skill works without these tools (plain file tools are enough); the tools
 * exist to keep frontmatter, index.md and graph.md consistent.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import * as store from './lib/store.js';
import { buildViewData, readEntry } from './lib/view-data.js';

export const name = 'cognitive-library';
export const inject = ['tools', 'skills', 'webServer'];

export const Config = z.object({
  root: z.string().default(''),
  categories: z.array(z.string()).default(store.DEFAULT_CATEGORIES),
});

const SKILL_RANK = 900; // after project/user skill roots, before bundled skills

function textResult(text) {
  return [{ type: 'text', text }];
}

function formatEntry(entry) {
  const tags = entry.tags.length ? ` ${entry.tags.map((t) => `#${t}`).join(' ')}` : '';
  const kind = entry.type === 'article' ? '文章' : '卡片';
  return [`${kind} · ${entry.category}${tags} · ${entry.created} · ${entry.id}`, `  ${entry.title}`,
    entry.summary ? `  ${entry.summary}` : ''].filter(Boolean).join('\n');
}

export function apply(ctx, config = {}) {
  const root = () => store.resolveRoot(config.root);

  ctx.tools.register(defineTool({
    name: 'cognitive_save',
    description:
      '保存一条认知到本地知识库（cognitive-library）。先判断内容能否独立成篇：能就存 article，不能就存 card；' +
      '篇幅不是标准，完整度才是。分类必须已存在；若没有合适的分类，先问用户要不要新建，再用 cognitive_category add。',
    parameters: {
      title: { type: 'string', required: true, description: '标题，一句话说清这条认知是什么' },
      body: { type: 'string', required: true, description: 'Markdown 正文' },
      type: { type: 'string', enum: ['card', 'article'], description: 'card=短认知，article=成文。默认 card' },
      category: { type: 'string', description: '分类，必须是认知库已有分类；不确定就先用 cognitive_category list 看' },
      tags: { type: 'array', items: { type: 'string' }, description: '自由标签，可留空' },
      summary: { type: 'string', description: '一句话结论，用于索引' },
      source_kind: { type: 'string', enum: ['chat', 'url', 'file', 'text'], description: '来源类型' },
      source_ref: { type: 'string', description: '来源标识：链接、文件名或会话说明' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          type: { type: 'string', required: true },
          category: { type: 'string', required: true },
          path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => textResult(`已写入 ${value.type === 'article' ? '文章' : '卡片'}：${value.title}\n${value.path}`),
    },
    async execute(args) {
      const entry = await store.saveEntry(root(), {
        title: args.title,
        body: args.body,
        type: args.type,
        category: args.category,
        tags: args.tags,
        summary: args.summary,
        source: { kind: args.source_kind || 'text', ref: args.source_ref },
      });
      return { id: entry.id, title: entry.title, type: entry.type, category: entry.category, path: entry.path };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'cognitive_list',
    description: '列出认知库中的条目，可按类型、分类、标签过滤。',
    parameters: {
      type: { type: 'string', enum: ['card', 'article'] },
      category: { type: 'string' },
      tag: { type: 'string' },
      limit: { type: 'number', description: '最多返回几条，默认 20' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                type: { type: 'string', required: true },
                category: { type: 'string', required: true },
                summary: { type: 'string' },
                created: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) =>
        textResult(value.count ? value.entries.map((e) => `${e.type === 'article' ? '文章' : '卡片'} · ${e.category} · ${e.created} · ${e.id}\n  ${e.title}`).join('\n') : '（空）'),
    },
    async execute(args) {
      const entries = await store.listEntries(root(), {
        type: args.type,
        category: args.category,
        tag: args.tag,
        limit: args.limit || 20,
      });
      return {
        count: entries.length,
        entries: entries.map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          category: e.category,
          summary: e.summary,
          created: e.created,
        })),
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'cognitive_search',
    description: '在认知库的标题、摘要、标签与正文中做子串检索。',
    parameters: {
      query: { type: 'string', required: true },
      type: { type: 'string', enum: ['card', 'article'] },
      category: { type: 'string' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                type: { type: 'string', required: true },
                category: { type: 'string', required: true },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) =>
        textResult(value.count ? value.hits.map((e) => `${e.id}\n  ${e.title}${e.summary ? ` — ${e.summary}` : ''}`).join('\n') : '没有命中。'),
    },
    async execute(args) {
      const hits = await store.searchEntries(root(), args.query, { type: args.type, category: args.category });
      return {
        count: hits.length,
        hits: hits.slice(0, 30).map((e) => ({ id: e.id, title: e.title, type: e.type, category: e.category, summary: e.summary })),
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'cognitive_relate',
    description:
      '给两条已有认知建立关联，写进关系图（graph.md）。只建立联系，不合并内容。注意：不能用于条目与自身。',
    parameters: {
      from: { type: 'string', required: true, description: '条目 id' },
      to: { type: 'string', required: true, description: '条目 id' },
      note: { type: 'string', description: '这条关联说明什么（为什么相关、怎么呼应）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          created: { type: 'boolean', required: true },
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => textResult(`${value.created ? '已建立' : '已更新'}关联：${value.from} ↔ ${value.to}${value.note ? `（${value.note}）` : ''}`),
    },
    async execute(args) {
      const result = await store.relate(root(), args.from, args.to, args.note || '');
      return { created: result.created, from: result.edge.from, to: result.edge.to, note: result.edge.note };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'cognitive_category',
    description:
      '查看、新增或重命名认知库分类。新增分类前必须先征得用户同意，并把用户给的名字原样传入。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'add', 'rename'] },
      name: { type: 'string', description: 'add 时的新分类名，或 rename 时的旧分类名' },
      new_name: { type: 'string', description: 'rename 时的新名字' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          categories: { type: 'array', required: true, items: { type: 'string' } },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => textResult(`${value.message}\n现有分类：${value.categories.join('、')}`),
    },
    async execute(args) {
      const at = root();
      if (args.action === 'add') {
        const result = await store.addCategory(at, args.name);
        return {
          categories: result.categories,
          message: result.added ? `已新增分类「${args.name}」。` : `分类「${args.name}」已存在。`,
        };
      }
      if (args.action === 'rename') {
        const result = await store.renameCategory(at, args.name, args.new_name);
        return { categories: await store.listCategories(at), message: `已重命名并迁移 ${result.moved} 条。` };
      }
      return { categories: await store.listCategories(at), message: '当前分类：' };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'cognitive_reindex',
    description: '重建认知库的 index.md（按分类）与 graph.md（关系图）。改动分类或关联后调用。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: { type: 'integer', required: true },
          articles: { type: 'integer', required: true },
          cards: { type: 'integer', required: true },
          relations: { type: 'integer', required: true },
          index: { type: 'string', required: true },
          graph: { type: 'string', required: true },
        },
      },
      render: (_args, value) =>
        textResult(`已重建索引：${value.articles} 篇文章、${value.cards} 张卡片、${value.relations} 条关联\n${value.index}\n${value.graph}`),
    },
    async execute() {
      const stats = await store.reindex(root());
      return {
        entries: stats.entries,
        articles: stats.articles,
        cards: stats.cards,
        relations: stats.relations,
        index: stats.index,
        graph: stats.graph,
      };
    },
  }));

  const skillDir = join(dirname(fileURLToPath(import.meta.url)), 'skills', 'cognitive-library');
  const provider = {
    name: 'cognitive-library',
    list: () => Promise.resolve([{
      name: 'cognitive-library',
      description:
        '把一次聊天、一篇文章或一段话整理成认知库条目（文章或卡片），按分类归档并维护关系图。用户提到认知库、知识库、总结归档、重新分类时使用。',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'cognitive-library',
      source: 'plugin',
      rank: SKILL_RANK,
      resourceBase: { kind: 'directory', path: skillDir.split('\\').join('/') },
      locator: join(skillDir, 'SKILL.md'),
    }]),
    async get(candidate) {
      const raw = readFileSync(candidate.locator, 'utf8');
      const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u.exec(raw);
      const content = (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim();
      const categories = await store.listCategories(root());
      const runtime = [
        '',
        '## 本机配置',
        '',
        `- 库根目录：\`${root()}\``,
        `- 现有分类：${categories.join('、')}`,
        `- 优先使用 cognitive_save / cognitive_list / cognitive_search / cognitive_relate / cognitive_category / cognitive_reindex 这些工具；没有这些工具时，按本文件描述直接读写文件。`,
      ].join('\n');
      const { rank: _rank, locator: _locator, ...summary } = candidate;
      return { ...summary, content: content + runtime };
    },
  };
  ctx.skills.registerProvider(() => provider);

  // ---- HTTP routes for the main-panel UI ----
  // Local-only JSON endpoints: the client panel fetches these instead of needing
  // a Remote/typert descriptor. Every payload is derived from the library root.
  const routes = [
    {
      kind: 'exact',
      path: '/api/cognitive-library/index',
      handler: async (req, res) => {
        if (!isLoopback(req)) return deny(res);
        try {
          writeJson(res, 200, await buildViewData(root()));
        } catch (error) {
          writeJson(res, 500, { error: String(error && error.message ? error.message : error) });
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/cognitive-library/entry',
      handler: async (req, res) => {
        if (!isLoopback(req)) return deny(res);
        try {
          const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? '';
          const entry = await readEntry(root(), id);
          if (!entry) return writeJson(res, 404, { error: 'entry not found' });
          writeJson(res, 200, entry);
        } catch (error) {
          writeJson(res, 500, { error: String(error && error.message ? error.message : error) });
        }
      },
    },
  ];
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'cognitive-library: http routes');
}

function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function deny(res) {
  writeJson(res, 403, { error: 'loopback only' });
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}
