#!/usr/bin/env node
/**
 * cogni — command line access to a cognitive-library folder.
 *
 * Works without the DSH plugin, which makes it useful for testing, for other
 * agents, and for batch jobs (reindex, category rename).
 */

import { readFile } from 'node:fs/promises';
import * as store from '../lib/store.js';

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function print(entry) {
  const tags = entry.tags?.length ? ` ${entry.tags.map((t) => `#${t}`).join(' ')}` : '';
  console.log(`${entry.type === 'article' ? '文章' : '卡片'} · ${entry.category}${tags} · ${entry.created} · ${entry.id}`);
  console.log(`  ${entry.title}`);
  if (entry.summary) console.log(`  ${entry.summary}`);
}

const [command, ...rest] = process.argv.slice(2);
const { flags, positional } = parseArgs(rest);
const root = store.resolveRoot(flags.root);

try {
  switch (command) {
    case 'save': {
      const raw = flags.json === true || flags.json === undefined
        ? await readStdin()
        : await readFile(String(flags.json), 'utf8');
      const input = JSON.parse(raw);
      const entry = await store.saveEntry(root, input);
      console.log(`已写入 ${entry.type === 'article' ? '文章' : '卡片'}: ${entry.title}`);
      console.log(entry.path);
      break;
    }
    case 'list': {
      const entries = await store.listEntries(root, {
        type: flags.type,
        category: flags.category,
        tag: flags.tag,
        limit: flags.limit ? Number(flags.limit) : undefined,
      });
      if (flags.json) {
        console.log(JSON.stringify(entries, null, 2));
        break;
      }
      if (!entries.length) {
        console.log('（空）');
        break;
      }
      for (const entry of entries) print(entry);
      break;
    }
    case 'search': {
      const query = positional.join(' ');
      const hits = await store.searchEntries(root, query, { type: flags.type, category: flags.category });
      if (flags.json) {
        console.log(JSON.stringify(hits, null, 2));
        break;
      }
      if (!hits.length) {
        console.log(`没有匹配 "${query}" 的条目。`);
        break;
      }
      console.log(`命中 ${hits.length} 条：`);
      for (const entry of hits) print(entry);
      break;
    }
    case 'relate': {
      const [from, to] = positional;
      if (!from || !to) throw new Error('用法: cogni relate <fromId> <toId> [--note "..."]');
      const result = await store.relate(root, from, to, flags.note === true ? '' : flags.note || '');
      console.log(result.created ? '已建立关联。' : '关联已存在，已更新说明。');
      console.log(`${result.edge.from} ↔ ${result.edge.to}${result.edge.note ? `：${result.edge.note}` : ''}`);
      break;
    }
    case 'reindex': {
      const stats = await store.reindex(root);
      console.log(JSON.stringify(stats, null, 2));
      break;
    }
    case 'cat':
    case 'categories': {
      const action = positional[0] || 'list';
      if (action === 'list') {
        console.log((await store.listCategories(root)).join('\n'));
      } else if (action === 'add') {
        const name = positional.slice(1).join(' ');
        const result = await store.addCategory(root, name);
        console.log(result.added ? `已新增分类：${name}` : `分类已存在：${name}`);
        console.log(`现有分类：${result.categories.join('、')}`);
      } else if (action === 'rename') {
        const [from, to] = positional.slice(1);
        const result = await store.renameCategory(root, from, to);
        console.log(`已把「${result.from}」重命名为「${result.to}」，迁移 ${result.moved} 条。`);
      } else {
        throw new Error(`未知子命令: ${action}`);
      }
      break;
    }
    default:
      console.log(
        [
          '用法: cogni <命令> [--root <目录>]',
          '',
          '  save --json <文件|->      从 JSON 写入卡片或文章（- 表示标准输入）',
          '  list [--type card|article] [--category X] [--tag Y] [--limit N] [--json]',
          '  search <关键词> [--json]',
          '  relate <fromId> <toId> [--note "说明"]',
          '  reindex                   重建 index.md 与 graph.md',
          '  cat list | cat add <名称> | cat rename <旧> <新>',
          '',
          `当前库根目录: ${root}`,
        ].join('\n'),
      );
  }
} catch (error) {
  console.error(`错误: ${error.message}`);
  process.exitCode = 1;
}
