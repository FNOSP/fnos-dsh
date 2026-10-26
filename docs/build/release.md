# 发布流程

## 发布新版本

在工作区干净且应用改动已完成后，使用根目录的 `fnos-dsh-cli` CLI 执行项目版本升级：

```bash
pnpm run version -- project patch
```

需要发布功能版本或大版本时，分别使用 `pnpm run version -- project minor` 或 `pnpm run version -- project major`。插件发布必须单独指定插件：

```bash
pnpm run version -- plugin fnos patch
```

**版本更新是发布的前置步骤**：修改插件或项目的功能结束后必须先执行对应的 `pnpm run version` 更新版本（见[版本管理 → 版本更新时机](./versioning.md#版本更新时机强制)），再进入发布流程；不允许改动落库后带着旧版本发布。版本命令产生的 Tag 只留在本地不推送，推送由发布者手动执行；非交互执行带 `--yes`。

脚本会创建类似下面的提交和 Tag：

```text
chore: release v5.0.7
v5.0.7
```

## 发布 npm 插件

当前 npm 发布仅支持 `next` dist-tag。三种入口：

```bash
pnpm run publish                        # 交互多选要发布的插件
pnpm run publish -- --plugin fnos       # 只发一个
pnpm run publish -- --all               # 发全部插件（CI 与非交互环境用）
pnpm run publish -- --all --skip-market-index   # 跳过收尾的索引同步
```

`--all` 与 `--plugin` 同时给出会**直接报错**，不会静默取其一——静默选择会让人以为「只发了指定的那个」而实际发了全部，这类误发无法撤回。

选定后逐个**串行**发布（不并发：同时启动会让 npm 在每个包上各弹一次授权，而首个凭据尚未落盘）。每个包先 `pnpm pack` 出产物并校验 `catalog:` 已解析，再交给 `npm publish`——`npm publish <tgz>` 用 npm 自己的凭据，不受 pnpm 侧凭据问题影响。共享的 `dsh-semi-ui` 包不参与发布。

### `pnpm login` 不等于 `npm` 已登录（发布前自检）

发布命令用 **`npm publish`**：只有 pnpm 会解析 `catalog:`，所以包由 `pnpm pack` 打、
由 `npm` 上传。这意味着**两个工具各自的凭据都要能对上**，而它们读的配置文件不同：

| 工具 | macOS 上的配置位置 |
| --- | --- |
| `pnpm` | `~/Library/Preferences/pnpm/config.yaml` |
| `npm` | `~/.npmrc` |

`pnpm login` 只写 pnpm 那边。此时 `pnpm whoami` 正常、`npm whoami` 返回 401，而
`npm publish` 的报错是 **E404 Not Found**（npm 对无权限的 PUT 不返回 401），文案是
「could not be found or you do not have permission」——看起来像包不存在。

发布命令因此加了前置自检：`npm` 未登录时**一个包都不发**并直接给出同步命令。手工修复：

```sh
npm config set //registry.npmjs.org/:_authToken "$(pnpm config get //registry.npmjs.org/:_authToken)"
npm whoami # 应打印用户名；仍 401 说明 token 已失效，需要重新签发
```

若 token 确实失效（`curl -H "Authorization: Bearer <token>" https://registry.npmjs.org/-/whoami`
返回 401），只能去 npm 网站重新签发——同步命令解决的是「位置不对」，不是「凭据过期」。

### 插件市场索引由发布命令自动同步

插件市场索引（`docs/public/plugins/market/index.json`）由上游生成器读取 **npm 上已发布版本**的
tarball 产出，不随源码或 `npm publish` 自动变化。发布命令在全部插件发完后自动重新生成，
因此不需要手动记这一步。

- 生成器不在本仓库内，位于上游检出。定位顺序：`DSH_DESKTOP_APP_DIR` → 工作区内的
  `fork-pj/deepseek-harness`。找不到时**只警告不中断**：包已经发出去了，索引是事后可补的动作。
- 生成器不可用时（未配置检出、离线）事后补跑：`pnpm exec fnos-dsh-cli market:index`。
- **成功判据是「索引文件真被改动」而不是退出码**：pnpm 在没有任何项目匹配 filter 时也以 0 退出，
  只看退出码会把「命令成功、索引没变」误报成同步完成。
- 离线或不需要时用 `--skip-market-index` 跳过。
- 仓库测试守住一致性：索引里每个插件的最高版本必须等于 npm 上该插件的 `next` 标签，落后即失败并提示重新生成（见 [插件市场索引](/plugins/market)）。

### `latest` dist-tag 由发布命令自动维护（FNOS-012-04）

npm 的 `latest` 只在无 tag 发布时才会移动，而本仓库只发 `next`——不维护的话
`latest` 会长期停在历史版本，`npm i <包>` 默认装到旧版。发布命令在每个插件
`publish:next` 成功后按**代际规则**自动维护 `latest`，无需发布后手动设置：

- 版本形态固定为 `<上游版本>.<修订>`（如 `0.2.0-rc.2.0`），**代际** = 去掉最后
  一个修订段的前缀（`0.2.0-rc.2.0` 与 `0.2.0-rc.2.1` 同代际）。
- **新代际首版**发布时：`latest` 自动指向**上一代最新稳定版**（从 npm 已知版本
  解析），`pnpm run publish` 的输出会打印该变更，可审计。
- **同代际迭代版**：不动 `latest`，只更新 `next`。

发布输出出现 `latest: skip` 时说明当次未校正（离线、npm view 不可用或没有上一
代），此时按需手工校正。应急命令（`dist-tag set` 不是有效子命令）：

```bash
npm dist-tag add <包名>@<版本> latest   # 校正（幂等，可重复执行）
npm dist-tag ls <包名>                  # 查看全部 dist-tags
npm dist-tag rm <包名> <tag>            # 移除误加的 tag
```

备选方式：`pnpm publish --tag latest` 在发布那一刻直接指定；registry HTTP
`PUT /-/package/<pkg>/dist-tags`（body 为完整 dist-tags JSON，需 Bearer token）
适合脚本化批处理。

### 发布前复核产物（FNOS-012-05）

`keeps each compatibility package list aligned with source imports` 与
`keeps every documented install command on the released plugin version` 两条
用例只校验**仓库内**清单与安装命令，不校验已发布包的产物。因此：

- 发布前确认工作区干净：`git status` 无未提交改动，避免「源码已修、线上包未含」
  的时序漏网（FNOS-012-05 的真实缺口即由此产生——清单修正在发布后数十秒才提交）。
- 发布后若源码再改动产物相关文件（`compatibility.json`、`cordis.patch.yml`、
  `package.json`），必须随**下一次版本发布**进入线上包，不得让线上包与仓库源码
  长期不一致。
- 需要核对线上包内容时，下载已发布产物解包检查，不只看版本号：
  `npm pack <包名>@<版本>` 后解包读取 `compatibility.json`。

### 发布前必须在本地验证产物，不要靠发布后回看（强制性）

**任何进入公开 registry 的版本，其产物内容必须在 `pnpm run publish` 之前于
本地验证过。** 不得以「先发一版，看线上效果再补」的方式迭代。

验证对象是 `pnpm pack` 产出的 `.tgz`，不是工作区里的源码，也不是
`node_modules` 里的链接形态——只有 tarball 能反映 `files` 白名单、`exports`
映射与 `catalog:` 解析后的真实结果：

```bash
cd plugins/dsh-<插件>-plugin
pnpm pack
tar -tzf tnnevol-dsh-<插件>-<版本>.tgz   # 核对文件清单
```

按改动类型逐一核对：

| 改动内容 | 产物中必须看到 | 漏了会怎样 |
| --- | --- | --- |
| `keywords`、`icon` | `package.json` 的对应字段；`icon` 指向的文件本身 | 插件市场搜索与图标失效，发现页显示占位图 |
| `locale/*.json` | `locale/` 目录，且 `exports` 含 `./locale/*.json` | 插件市场条目标题回退成 npm 包名（`@scope/name`），用户认不出这是什么插件 |
| `compatibility.json`、`cordis.patch.yml` | 两个文件本身 | 兼容门禁失效或插件组合声明缺失，安装后不工作 |
| 新增依赖（尤其 `@deepseek-ai/dsh*`） | `package.json` 的 peer/dev 字段 | 类型解析失败，或运行时缺服务导致插件挂起 |

**对插件市场索引尤其重要**：索引生成器读取的是 **npm 上已发布版本**的
tarball，不是本地源码。元数据有缺时生成器**不会报错**，只是安静地少字段或
回退到包名。等到生成完索引、看见输出不对再补发新版本，等于在 registry 上留下
一个有缺陷的公开版本。

这条规则来自一次实测事故：`0.2.1-rc.2.1` 补齐了 `keywords` 与图标就发布并生成
索引，生成后才发现五个插件的标题全是包名——它们缺 `locale/`。补发
`0.2.1-rc.2.2` 后索引才正确，而 `0.2.1-rc.2.1` 成为已发布、无法撤回、也没人
使用的残次版本。若发布前跑一次 `pnpm pack` 看一眼文件清单，这轮补发不会发生。

同类误差还包括「本地看起来已经加了，但没进 `files` 白名单」：此时工作区正常、
tarball 里却没有，只有线上消费者会受影响。**以 tarball 为准，不以工作区为准。**

## 发布前必须确认清单里的插件版本已发布到 npm（强制性）

**推 Tag 之前，`published-dsh-plugins.json` 里每一个插件版本都必须在目标 registry 上存在；
缺一个就中止本次发布（打回），不得推 Tag、不得发 Release、不得提交上架申请。**

### 为什么这条是硬门禁

FPK 是**瘦包**——CI 用 `--skip-bundle-dsh-plugins` 构建（见
[`.github/workflows/build-app.yml`](https://github.com/FNOSP/fnos-dsh/blob/main/.github/workflows/build-app.yml)
的 FPK 构建步骤），插件不随包内置。安装回调按 `published-dsh-plugins.json` 里的**精确版本**
从 registry 拉取，因此「版本没发到 npm」不是降级、不是回退，而是**整次安装直接失败**：

```text
Running dsh plugin --profile web add @tnnevol/dsh-codex-auth@<版本>
[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for @tnnevol/dsh-codex-auth@<版本>
[ERROR] Unable to install @tnnevol/dsh-codex-auth@<版本> with the dsh CLI
```

用户侧的后果比发布失败更糟：DSH 本体与 trim-cli 已经装好，插件缺失，应用解不开——而他装的是
一个「官方发布的稳定版」。换镜像、清缓存都无效，因为该版本在任何源上都不存在。

### 校验命令（发布前必跑）

```bash
node -e '
const { readFileSync } = require("node:fs");
const { plugins } = JSON.parse(readFileSync("apps/fn-deepseek-harness/app/published-dsh-plugins.json", "utf8"));
(async () => {
  const missing = [];
  for (const p of plugins) {
    const res = await fetch("https://registry.npmjs.org/" + p.name.replace("/", "%2F") + "/" + p.version);
    console.log((res.ok ? "OK   " : "MISS ") + p.name + "@" + p.version + " (HTTP " + res.status + ")");
    if (!res.ok) missing.push(p.name + "@" + p.version);
  }
  if (missing.length > 0) { console.error("\n缺失 " + missing.length + " 个：" + missing.join(", ")); process.exit(1); }
  console.log("\n全部已发布，可以继续发布流程");
})();
'
```

判据是**退出码**，不是输出好看：

| 结果 | 含义 | 处置 |
| --- | --- | --- |
| 退出码 `0`，每行 `OK` | 清单里每个版本都能在 registry 取到 | 继续发布流程 |
| 退出码 `1`，出现 `MISS` | 至少一个版本不存在 | **打回**：先修清单或先发插件，再重新校验 |

第三方包（`dshmarket`）同样在校验范围内：它的注册表版本就是契约本身，缺了同样装不上。

### 打回后怎么修（二选一）

1. **先把插件发到 npm**：`pnpm run publish -- --all`（或在只改了部分插件时按需发），然后重跑校验；
2. **把清单回退到已发布版本**：`pnpm run version` 会把清单同步成当前源码里的插件版本，
   因此正确做法是先把插件版本发出去，而不是手改清单——手改会被下一次版本命令覆盖。

两种路径都要求**先校验通过再推 Tag**：Tag 一旦推出去，CI 会为该 Tag 建 Release 并挂上 FPK，
删 Release 要让 `Latest` 回落，已经下载过的用户也无法追回。

### 事故记录（v6.0.2）

2026-10-26 发布的 v6.0.2 就是这么坏的：清单把三个插件锚到 `6.0.2`，而 registry 上只有 `6.0.0`
（`6.0.1`~`6.0.5` 一个都没发）。安装回调在插件步骤必然失败，报 `ERR_PNPM_NO_MATCHING_VERSION`。
处置是把 v6.0.2 下架并删除该 Release。若发布前跑一次上面的校验命令，这次发布不会发生。

## 推送并触发构建

推 Tag 之前先过[插件版本校验](#发布前必须确认清单里的插件版本已发布到-npm-强制性)：校验不通过就不要推。

```bash
git push origin main
git push origin v<版本号>
```

构建完成后，在 GitHub Release 页面检查：

- 每个应用是否都有对应 `.fpk`。
- 文件名中的版本是否与 Tag 一致。
- Release 是否包含正确的提交记录。

## 在真实 NAS 上装机验证

Release 附件里的 FPK 拿到后，建议先在真实 fnOS NAS 上装一次再提交上架申请。操作步骤、版本号比较规则与排障见[从电脑上传 FPK 到 NAS 并安装](/guide/nas-fpk-install)。

## 提交应用上架申请

Release 发布成功并取得 FPK 后，按[应用上架规范](../charter/app-listing-spec.md)准备材料并提交飞牛上架申请。该规范给出表单字段口径、平台与上架类型的取值、官方 7 条自查规则在本项目的落点，以及提交前检查清单。

## 手动发布前检查

- **`published-dsh-plugins.json` 里每个插件版本都已在 registry 存在**（跑[校验命令](#校验命令-发布前必跑)，
  退出码必须为 `0`）；缺失即打回，不推 Tag。
- 本地 `git diff --check` 通过。
- 目标应用可以通过 `fnpack build` 构建。
- 项目/FPK 版本命令涉及的 Manifest 与目标项目版本一致；独立维护版本的应用和插件不要求与根 `package.json` 相同。
- 应用 README、安装向导和文档没有遗留旧版本或旧路径。
- Manifest 的 `desc` 与 `changelog` 已随本轮功能完成及时更新：`desc` 富文本（HTML）内容与当前功能一致，`changelog` 概括本轮变更；发布前不再临时补写。
- 待发布插件的产物已在本地用 `pnpm pack` 验证过文件清单，改动项按[发布前必须在本地验证产物](#发布前必须在本地验证产物-不要靠发布后回看-强制性)逐项核对；涉及插件市场元数据时，生成索引后的条目内容也已确认。
