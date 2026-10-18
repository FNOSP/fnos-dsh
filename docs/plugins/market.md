# 插件市场索引

DSH `0.2.1` 起支持第三方插件市场：在「发现」页添加一个索引 URL，就能浏览该市场列出的插件并直接安装。本仓库发布一份这样的索引，列出全部六个运行时插件。

本文说明如何添加本项目的索引源、索引里有什么，以及维护者如何重新生成它。

## 通过市场安装

### 1. 启用自定义插件市场

插件市场是实验性的可选能力，默认关闭。在插件页启用「自定义插件市场」并重启 DSH，插件页会出现「发现」页签。

### 2. 添加索引源

在「发现」页添加以下 URL 作为索引源：

```text
https://fndsh-doc.tnnevol.cn/plugins/market/index.json
```

索引源属于用户自己的配置，保存在 profile 中，不被任何插件改写。添加索引源会引入新的代码来源，界面会给出信任提示。

### 3. 浏览与安装

每个条目显示插件的名称、用途说明、图标、作者与可用版本。进入条目可以查看全部版本与来源信息，选择一个版本即可安装。安装沿用 DSH 既有的安装流程：兼容性检查、构建脚本批准与版本拒绝规则照常生效。

索引是按插件分别浏览的，不是所有市场合并成一个列表——不同市场的分类 id 含义可能不同。

## 索引内容

索引由上游官方生成器 `@deepseek-ai/dsh-plugin-market-generator` 从 npm 直接读取生成，不是手写维护。

| 字段 | 来源 |
| --- | --- |
| 名称、描述 | 插件包内 `locale/en.json` 与 `locale/zh.json` 的 `meta.title`、`meta.description` |
| 图标 | 插件 `package.json` 的 `icon`（包内相对路径文件） |
| 版本与发布时间 | npm registry 上该包未弃用、声明了 `dsh.bundle` 的版本 |
| 兼容范围 | 插件 `package.json` 的 `engines.dsh` 或 DSH 同行依赖范围 |
| 作者、主页、仓库 | 插件 `package.json` 的同名字段 |
| 关键词 | 插件 `package.json` 的 `keywords` |

### 关于图标

只为有可信官方品牌素材的插件声明图标：

| 插件 | 图标 |
| --- | --- |
| `@tnnevol/dsh-fnos` | 飞牛 fnOS 官方品牌标识 |
| `@tnnevol/dsh-codebuddy` | 腾讯 CodeBuddy 官方标识 |
| `@tnnevol/dsh-midscene` | 本插件自有图标 |
| `@tnnevol/dsh-codex-auth` | 无（未取到可确认归属的官方素材，省略） |
| `@tnnevol/dsh-failover-search` | 无（同上） |
| `@tnnevol/dsh-semi-ui-showcase` | 无（同上） |

省略是有意的：用通用图形或自制图标冒充品牌标识会让用户误认来源。缺少图标只影响识别度，不影响安装与使用。

## 维护索引

### 前置条件

生成器是上游 DSH 仓库里的独立 Node 程序，不在本仓库内。需要在 `fork-pj/deepseek-harness` 检出中运行。

### 重新生成

在仓库根执行：

```sh
cd "$DSH_DESKTOP_APP_DIR/apps/plugin-market-generator"
npx tsx src/bin.ts \
  --input <本仓库>/docs/public/plugins/market/plugins.txt \
  --output <本仓库>/docs/public/plugins/market/index.json \
  --cache <本仓库>/tmp/plugin-market-cache \
  --title "飞牛 fnOS DSH 插件" \
  --description "为飞牛 fnOS 维护的 DSH 插件：模型提供方、搜索故障转移、浏览器自动化与系统集成。"
```

源列表 `plugins.txt` 与本文件同目录，每行一个 npm 包名，`#` 开头为注释。

### 什么时候必须重新生成

**每次发布插件新版本之后。** 生成器读取的是 **npm 上已发布版本**的 tarball，不是本地源码：

- 改了 `keywords` 或 `icon` 但没发版，索引里不会有它们。
- 发了新版本但没重新生成，发现页显示的就是旧版本。

索引是随文档站一起发布的静态文件，不会自动更新。

### 发版前先验证产物，别指望生成器报错

元数据缺失时生成器**不报错**，它只是安静地少字段或回退到包名。因此发布前必须
在本地确认产物内容，而不是发完再生成索引回看：

```bash
cd plugins/dsh-<插件>-plugin
pnpm pack
tar -tzf tnnevol-dsh-<插件>-<版本>.tgz
```

要看到的是：`package.json` 里的 `keywords` 与 `icon`、`icon` 指向的图片文件本
身、`locale/` 目录，以及 `exports` 里有没有 `./locale/*.json`。文件不在 `files`
白名单里就不会进 tarball，本地工作区看起来正常但线上消费者拿不到。

历史上漏过一次：只补了 `keywords` 与图标就发版，生成索引后才发现五个插件的标题
全是包名——它们缺 `locale/`。补发的中间版本无法撤回，成为无人使用的残次品。完
整规则见[发布流程](/build/release#发布前必须在本地验证产物-不要靠发布后回看-强制性)。

### 校验

仓库的测试会守住两件最容易忘的事：

- 索引里每个插件的最高版本必须等于 npm 上该插件的 `next` 标签——落后会直接失败，并提示重新生成。
- 每个插件都必须有 `keywords`。

离线时版本一致性用例会跳过而不是失败。

```sh
pnpm --filter @tnnevol/fnos-dsh-cli test
```

### 已知的生成器输出

- 生成器会列出插件在 npm 上的**全部**历史版本（从 `0.2.0-rc.2.x` 起）。安装时由用户选择版本，兼容性由 DSH 的兼容门禁判定。
- 生成器对个别历史版本会报 `DSH range "catalog:dsh" is not a valid SemVer range` 并跳过该版本——那是历史上误把 catalog 协议写进 peer 的产物，属预期的兼容性过滤。
- 同一份源列表重复生成得到完全相同的内容，可以直接用 `git diff` 对比。

## 相关文档

- [插件总览](/plugins/)
- [发布流程](/build/release)
- [FNOS-016 需求](/requirements/FNOS-016-plugin-market-index)
