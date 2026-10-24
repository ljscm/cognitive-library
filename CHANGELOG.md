# Changelog

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
