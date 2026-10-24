import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from '../lib/store.js';

async function fresh() {
  const root = join(await mkdtemp(join(tmpdir(), 'cogni-')), 'library');
  await store.ensureLibrary(root);
  return root;
}

test('ensureLibrary creates skeleton and default categories', async () => {
  const root = await fresh();
  assert.ok(existsSync(join(root, 'cards')));
  assert.ok(existsSync(join(root, 'articles')));
  const categories = await store.listCategories(root);
  assert.deepEqual(categories, store.DEFAULT_CATEGORIES);
  await rm(root, { recursive: true, force: true });
});

test('saveEntry writes frontmatter that parses back', async () => {
  const root = await fresh();
  const saved = await store.saveEntry(root, {
    title: '长上下文并不取代检索',
    body: '结论：上下文窗口变长，检索仍然有价值。\n\n理由是成本与注意力稀释。',
    type: 'card',
    category: '科技',
    tags: ['RAG', '上下文'],
    summary: '窗口变大不等于检索失效',
    source: { kind: 'chat', ref: '本次会话' },
    date: '2026-10-24',
  });
  const entry = await store.getEntry(root, saved.id);
  assert.equal(entry.title, '长上下文并不取代检索');
  assert.equal(entry.type, 'card');
  assert.equal(entry.category, '科技');
  assert.deepEqual(entry.tags, ['RAG', '上下文']);
  assert.equal(entry.summary, '窗口变大不等于检索失效');
  assert.equal(entry.source.kind, 'chat');
  assert.match(entry.body, /注意力稀释/);
  await rm(root, { recursive: true, force: true });
});

test('unknown category is rejected with the existing list', async () => {
  const root = await fresh();
  await assert.rejects(
    () => store.saveEntry(root, { title: 't', body: 'b', category: '玄学' }),
    /unknown category.*政治/s,
  );
  const saved = await store.saveEntry(root, { title: '待归类可以', body: 'b', category: '待归类' });
  assert.equal(saved.category, '待归类');
  await rm(root, { recursive: true, force: true });
});

test('same title on the same day gets a distinct id', async () => {
  const root = await fresh();
  const a = await store.saveEntry(root, { title: '同名', body: 'a', date: '2026-10-24' });
  const b = await store.saveEntry(root, { title: '同名', body: 'b', date: '2026-10-24' });
  assert.notEqual(a.id, b.id);
  assert.equal(b.id, `${a.id}-2`);
  await rm(root, { recursive: true, force: true });
});

test('cards and articles coexist without decomposition', async () => {
  const root = await fresh();
  await store.saveEntry(root, { title: '一篇', body: '正文', type: 'article', category: '科技' });
  await store.saveEntry(root, { title: '一张', body: '短判断', type: 'card', category: '科技' });
  const all = await store.listEntries(root);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((e) => e.type).sort(), ['article', 'card']);
  assert.equal((await readdir(join(root, 'articles'))).length, 1);
  assert.equal((await readdir(join(root, 'cards'))).length, 1);
  await rm(root, { recursive: true, force: true });
});

test('relate is undirected-idempotent and shows up in graph.md', async () => {
  const root = await fresh();
  const a = await store.saveEntry(root, { title: 'A', body: 'a', category: '科技' });
  const b = await store.saveEntry(root, { title: 'B', body: 'b', category: '心理' });
  const first = await store.relate(root, a.id, b.id, '这里互相补充');
  assert.equal(first.created, true);
  const again = await store.relate(root, b.id, a.id, '互相补充与反驳');
  assert.equal(again.created, false);
  assert.equal(again.edge.note, '互相补充与反驳');
  const relations = await store.listRelations(root);
  assert.equal(relations.length, 1);
  const graph = await readFile(join(root, 'graph.md'), 'utf8');
  assert.match(graph, /graph LR/);
  assert.match(graph, /互相补充与反驳/);
  await rm(root, { recursive: true, force: true });
});

test('reindex groups by category and counts types', async () => {
  const root = await fresh();
  await store.saveEntry(root, { title: '文章一', body: 'x', type: 'article', category: '科技' });
  await store.saveEntry(root, { title: '卡片一', body: 'y', type: 'card', category: '心理' });
  await store.saveEntry(root, { title: '卡片二', body: 'z', type: 'card', category: '科技' });
  const stats = await store.reindex(root);
  assert.equal(stats.entries, 3);
  assert.equal(stats.articles, 1);
  assert.equal(stats.cards, 2);
  const index = await readFile(join(root, 'index.md'), 'utf8');
  assert.match(index, /## 科技/);
  assert.match(index, /## 心理/);
  assert.match(index, /### 文章/);
  assert.match(index, /### 卡片/);
  assert.match(index, /1 篇文章 · 2 张卡片/);
  await rm(root, { recursive: true, force: true });
});

test('renameCategory migrates entries and rebuilds the index', async () => {
  const root = await fresh();
  await store.saveEntry(root, { title: '要迁移', body: 'x', category: '科技' });
  const result = await store.renameCategory(root, '科技', '技术');
  assert.equal(result.moved, 1);
  const categories = await store.listCategories(root);
  assert.ok(categories.includes('技术'));
  assert.ok(!categories.includes('科技'));
  const entries = await store.listEntries(root, { category: '技术' });
  assert.equal(entries.length, 1);
  const index = await readFile(join(root, 'index.md'), 'utf8');
  assert.match(index, /## 技术/);
  assert.doesNotMatch(index, /## 科技/);
  await rm(root, { recursive: true, force: true });
});

test('search matches body text and filters by category', async () => {
  const root = await fresh();
  await store.saveEntry(root, { title: '注意力', body: '注意力稀释是长上下文的隐性成本', category: '科技' });
  await store.saveEntry(root, { title: '别的', body: '无关内容', category: '心理' });
  const hits = await store.searchEntries(root, '稀释');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, '注意力');
  assert.equal((await store.searchEntries(root, '无关', { category: '科技' })).length, 0);
  await rm(root, { recursive: true, force: true });
});

test('slugify keeps CJK readable and strips unsafe characters', () => {
  assert.equal(store.slugify('长上下文/并不:取代 检索'), '长上下文-并不-取代-检索');
  assert.equal(store.slugify('分类受控，新增先问人'), '分类受控-新增先问人');
  assert.equal(store.slugify('RAG vs Long Context'), 'rag-vs-long-context');
  assert.equal(store.slugify('///'), 'entry');
});
