# Changelog

## 0.1.0 — 2026-10-24

第一个可用版本。

- 卡片（card）与文章（article）两类条目；存哪一类由模型按内容能否独立成篇判断
- 受控分类：默认政治 / 经济 / 科技 / 心理 / 生活，新增需用户确认
- `index.md` 按分类重建，`graph.md` 输出 Mermaid 关系图与关联列表
- 6 个 Host 工具：save / list / search / relate / category / reindex
- `cognitive-library` 技能：约定文章风格、卡片粒度、分类与关系规则
- 命令行 `cogni`：不依赖 DSH 运行时，可单独使用
- 10 项 Node 测试
