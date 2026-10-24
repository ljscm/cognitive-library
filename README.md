# Cognitive Library 认知库

把一次聊天、一篇文章、一段话，整理成**你自己知识库里的文章或卡片**，按分类归档，并且让它们之间有关系。

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的插件 + 技能。纯本地 Markdown，没有数据库，没有云，用 git 就能管理。

## 它解决什么

和 AI 讨论完，认知往往散在聊天的不同轮次里：结论在一个地方，理由在另一处，边界条件在第三处。下次要用时找不回来。

认知库把一次讨论收成**一份能重读的文本**，并且回答两个问题：

- 这条认知该归到哪一类？
- 它和库里哪些内容互相呼应、互相反驳？

## 两种条目，平级

| 类型 | 用途 | 典型长度 |
|---|---|---|
| `article` | 一条完整思路，值得单独成文 | 800–3000 字 |
| `card` | 一个判断、一条经验，撑不起一篇文章 | 100–500 字 |

**文章不会被拆成卡片。** 卡片是"短到成不了文"的条目，不是为了结构化而产生的碎片。

## 目录结构

```
<库根目录>/
  index.md          按分类索引（生成物，每次写入后重建）
  graph.md          关系图：Mermaid 图 + 关联列表（生成物）
  cards/<日期>-<标题>.md
  articles/<日期>-<标题>.md
  .cogni.json       分类表
  relations.json    关系数据
```

默认库根目录：`$DSH_HOME/cognitive-library`（即 `~/.dsh/cognitive-library`），可用环境变量 `COGNITIVE_LIBRARY_HOME` 或插件配置 `root` 覆盖。

## 安装

### 方式一：插件（推荐）

```bash
# 在 DSH 的 profile 目录
pnpm add /绝对路径/cognitive-library
```

然后在 profile 的 `package.json` 的 `dsh.profile.bundles` 里追加 `"dsh-cognitive-library"`，重启 DSH。
插件会注册 6 个工具和一个技能。

### 方式二：只装技能，不装插件

把 `skills/cognitive-library/` 整个目录复制到：

- 用户级：`~/.dsh/skills/cognitive-library/`
- 或项目级：`<项目>/.dsh/skills/cognitive-library/`

技能会让模型直接读写 Markdown（结构一致），不需要工具。

### 方式三：只用命令行

```bash
node bin/cogni.js list
node bin/cogni.js search 上下文
node bin/cogni.js reindex
```

`bin/cogni.js` 不依赖 DSH 运行时，可以给别的 agent、脚本或定时任务用。

## 工具

| 工具 | 作用 |
|---|---|
| `cognitive_save` | 写入一条（卡片或文章），自动落盘并重建索引 |
| `cognitive_list` | 按类型 / 分类 / 标签列出 |
| `cognitive_search` | 在标题、摘要、标签、正文里做子串检索 |
| `cognitive_relate` | 给两条内容建立关联（写进关系图） |
| `cognitive_category` | 查看 / 新增 / 重命名分类 |
| `cognitive_reindex` | 重建 `index.md` 与 `graph.md` |

## 命令行

```bash
cogni save --json entry.json     # 从 JSON 写入，- 表示读标准输入
cogni list --category 科技 --type article
cogni search 注意力
cogni relate <idA> <idB> --note "互相补充"
cogni cat list | cat add 认知科学 | cat rename 科技 技术
cogni reindex
```

## 三条设计决定

1. **分类是受控的。** 默认五类（政治 / 经济 / 科技 / 心理 / 生活）。分类不合适时，模型会先问你要不要新建、叫什么名字，而不是自己发明——否则半年后会有两百个只用过一次的目录。
2. **关系只连接，不合并。** 两条内容冲突或呼应时添加一条 `related`，正文保持原样。合并会丢信息，也会让"我当时为什么这么想"消失。
3. **重新分类不改正文。** 只改归属和索引，文章内容不动。

## 开发

```bash
node test/store.test.js      # 10 项测试，纯 Node，无依赖
node --check index.js
```

`lib/store.js` 是全部存储逻辑，不依赖 DSH，可以单独复用。

## 路线图

- [x] v0.1 卡片/文章、分类、索引、关系图、CLI
- [ ] 划选文本直接入库（Client 插件 + 对话选区入口）
- [ ] 链接摄入：通用网页正文提取，公众号/知乎降级为手动粘贴
- [ ] 批次重分类与同主题巡检
- [ ] 检索升级：从子串匹配到向量检索

## License

MIT
