# 开发与发布

## 本地开发：装的是链接目录

`plugin_manager install_bundle <仓库目录>` 会把 profile 里的包指向你的工作目录（junction），
所以**改文件不需要重新安装，更不需要发 npm**。

| 改了什么 | 怎么生效 |
|---|---|
| `client.js`、界面文案 | 刷新页面（Ctrl+R） |
| `index.js`、`lib/**`（Host 侧） | 重启 DSH（Host 模块有代际缓存，热改不生效） |
| `cordis.patch.yml` 里的 `config` | 改 profile 补丁层后重启 |
| `skills/**` | 刷新后新会话生效（技能目录会被监听） |

> 如果哪天改成从 npm 安装，本地改动就不会再自动生效了——那是两份不同的包。
> 开发期保持链接安装，切换前先 `remove_bundle`。

## 发布 npm：不是每次改动都要发

发布只在「想让别人装或升级」时才做。

- 平时：commit 随便提，不用动版本号
- 准备发：升版本 + 更新 CHANGELOG + 跑检查
- 版本规则：
  - `0.2.x`：修 bug、调文案
  - `0.3.0`：加功能、改数据格式（要写迁移说明）
- 发布：`npm publish`

用户侧的升级由他们自己的 DSH 完成，和你发不发无关；你不发，他们的旧版本也能一直用。

## 上市场

市场（dshopen.org）是独立的社区索引：npm 上先有包，再往索引里提一条记录。
在那之前，别人也能用「克隆仓库 + `install_bundle <目录>`」安装。

## 发版前检查

```bash
node test/store.test.js              # 存储逻辑
node --check index.js client.js      # 语法
node bin/cogni.js list --root <库>    # 在真库上跑一次
```

- [ ] 版本号与 CHANGELOG 一致
- [ ] 包内没有本机绝对路径（`grep -r "C:\\\\Users" .` 应该无输出）
- [ ] `files` 覆盖了新增文件
- [ ] README 里的安装命令仍然可用
