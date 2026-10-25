# Changelog

## 0.3.1 — 2026-10-25

- 修复 `package.json` 写入带 BOM 导致插件清单不可读（客户端模块因此完全不加载）
- 会话「⋯」菜单新增「知识整理」：解码整段会话（追加式多帧 zstd）后交给模型整理入库
- 会话整理会过滤运行期脚手架消息（runtime context、时间戳等），避免污染正文

## 0.3.0 — 2026-10-25

一键整理。

- 选中文字后浮出「知识整理」按钮（`shell.overlay`），点一下完成：模型整理 → 自动归类 → 入库 → 回执
- Host 新增 `POST /api/cognitive-library/digest`：调用模型做结构化整理，分类只能选已有的，不合适落「待归类」并回传建议类名
- 整理规则沿用技能口径：保留原文结构、保留原用词、不生造概念标题、不加编者评论
- 新增 toast 回执（成功/失败）

## 0.2.1 — 2026-10-24

可移植性。

- 插件包里的 `cordis.patch.yml` 不再写死本机库路径，默认 `$DSH_HOME/cognitive-library`
- 本机自定义路径改由 profile 补丁层覆盖
- README 补充 npm / GitHub / 纯技能 / CLI 四种安装方式

## 0.2.0 — 2026-10-24

主面板阅读器。

- 新增 Client 半边：左侧栏「认知库」按钮 + 主面板（分类导航、搜索、阅读区）
- 新增本地 HTTP 路由 `/api/cognitive-library/index` 与 `/entry`（仅回环地址可访问）
- 面板数据来自库本身，不额外维护副本
- 工具描述改为「按内容能否独立成篇判断文章/卡片」

## 0.1.0 — 2026-10-24

第一个可用版本。

- 卡片（card）与文章（article）两类条目；存哪一类由模型按内容能否独立成篇判断
- 受控分类：默认政治 / 经济 / 科技 / 心理 / 生活，新增需用户确认
- `index.md` 按分类重建，`graph.md` 输出 Mermaid 关系图与关联列表
- 6 个 Host 工具：save / list / search / relate / category / reindex
- `cognitive-library` 技能：约定文章风格、卡片粒度、分类与关系规则
- 命令行 `cogni`：不依赖 DSH 运行时，可单独使用
- 10 项 Node 测试
