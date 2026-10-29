# 版本管理

版本命令由根目录 `fnos-dsh-cli` CLI 暴露，实现在 `tooling/fnos-dsh-cli` workspace。**一条命令统一管理项目与全部插件版本**：两者共用同一个版本号（同号），一次执行全部推进，结果落在**同一条提交**里。版本计算、文件替换、release 提交与本地 tag 由 [`bumpp`](https://github.com/antfu-collective/bumpp) 原生完成（`chore: release v<版本>` 提交、`v<版本>` tag、永不 push）；命令入口有**工作区干净**硬守卫——脏工作区的无关改动会被 release 提交卷入，因此发版前必须先提交或贮藏全部改动。

不再有「先选区域」这一步：`project` / `plugin` 两个历史子命令**已被合并**，仍作为参数被接受但语义相同，写成 `pnpm run version -- patch` 即可。

## 版本形态（FNOS-028）

项目、全部插件与 FPK 的版本号是**纯净三段式 semver**（如 `5.10.0`）：

```text
5.10.0
└─┬─┘
  └── 项目与全部插件同号；每次发布按档位递增对应段，不使用预发布段
```

DSH 运行时基线（当前 `0.2.1-rc.2`）**不进入版本号**，由两处产物承载：

| 承载处 | 形态 | 维护方式 |
| --- | --- | --- |
| FPK 附件命名 | `fn-deepseek-harness-v<项目版本>-dsh-<DSH 基线>.fpk` | CI 构建期从 `pnpm-workspace.yaml` catalog 派生 |
| FPK `manifest` 描述 | 「运行基线为 DSH `<基线>`」字样 | 版本命令执行时对齐 catalog 当前值 |

## 版本档位语义

| 档位 | 含义 | 示例 |
| --- | --- | --- |
| `patch` | 无新功能的修复 | `5.10.0 → 5.10.1` |
| `minor` | 新功能，DSH 基线不变 | `5.10.1 → 5.11.0` |
| `major` | DSH 基线变更（携带 `--baseline`），或导致用户无法回退的重大调整 | `5.11.0 → 6.0.0` |

规则：

- 每次发布对应段自增 +1（进位段归零，bumpp 原生行为），不跳号。
- 新功能与基线变更同时发生时按 `major` 处理。
- **基线变更必须走 major**：`--baseline` 是 major 档位专属参数，与 `patch`/`minor` 搭配被拒绝——防止基线变更被小档位静默掩盖。
- 传完整版本号时必须是纯净三段式（如 `5.10.1`）；带 `-` 预发布段（含旧 FNOS-019 小尾巴形态如 `5.10.1-0.2.1-rc.2.1`）被拒绝并指引。

## 发布批次：一次发布覆盖一批变化，不是一个提交

档位语义回答「这次的号该怎么涨」，但不回答「**现在该不该发版**」。只按档位执行会得出「每完成一点改动就发一次版」，版本号随提交数量通胀。

**一次发布 = 一批用户可感知的变化**，粒度由需求收口决定，不由提交数决定。

### 判定规则

| 情形 | 是否发版 | 用什么档位 |
| --- | --- | --- |
| 一个需求的首次完整交付 | 发 | 按变化性质（新功能 `minor`，修复 `patch`） |
| 同一需求迭代中的连续修补（改样式、改交互、改文案、修上一版引入的问题） | **累积到需求收口后一次发布** | 收口时按整批变化性质定 |
| 中途需要装机验证，必须让版本号与已装版本不同 | 发 | **`patch`**，且只前进一格 |
| 纯文档、章程、测试用例文档 | 不发 | — |

### 装机验证性升版的档位固定为 patch

「为了能装上而换号」不是一次功能发布。此时**不重算档位**：无论这批改动里含有多少新功能，验证性升版一律用 `patch`。

理由：档位表达的是「对使用者的意义」，而验证性升版只解决「fnOS 按版本号判定安装」这个机械约束。按改动性质重算档位，会让同一需求的中间态产生 `minor`/`major` 级别的版本跨越，用户会以为发生了大版本升级。

### 反例（2026-10-28 实测）

同一个需求（FNOS-034 输入区选择器改造）连续发版 8 次，版本从 `6.0.6` 涨到 `6.3.3`，其中 7 次是迭代中途的修补：

| 次数 | 改动 | 当时用的档位 | 应有做法 |
| --- | --- | --- | --- |
| 1 | 需求建立 + 主体实现 | `minor` | ✅ 合理（首次交付） |
| 2 | 加层级、去搜索、新建 | `minor` | 累积，不发 |
| 3 | 气泡仅省略时提示 | `patch` | 累积，不发 |
| 4 | 改用 Typography | `patch` | 累积，不发 |
| 5 | FPK 命名对齐 CI | `minor` | 累积或独立需求 |
| 6~8 | 文档转义、右键菜单、移除多余入口 | `patch` | 累积，不发 |

结果是同一个需求产生了 8 个 tag，跨越 3 个 minor 段。用户视角像是经历了 3 次大版本升级，实际只是同一个功能的打磨过程。

## `targetVersion`：需求声明的目标发布版本

需求与计划文档的 frontmatter 里有 `targetVersion` 字段。它的语义此前**未在规范中定义**，导致字段存在但无约束力——上例中需求文档记着 `targetVersion: 6.1.0`，实际发布却跑到 `6.3.3`，中间没有任何环节发现不一致。

### 定义

`targetVersion` 是该需求**计划随哪一次发布交付**的版本号。它是「本需求的改动应累积到哪个版本一起交付」的声明，不是预估，也不是上限。

### 维护规则

| 时机 | 动作 |
| --- | --- |
| 建立需求时 | 填写预期承载该需求的版本（通常是下一个 `minor`） |
| 需求迭代中途 | **不改**。中途修补不产生新版本，因此 `targetVersion` 保持不动 |
| 需求收口发版时 | 确认发布版本与 `targetVersion` 一致；若因排队等原因变更，**同步更新字段** |
| 需求拆分或顺延时 | 更新为本轮实际承载的版本，并在变更记录里说明 |

### 自查（发版前执行）

```bash
# 当前在推进的需求及其目标版本
grep -l "status: in-progress" docs/requirements/*.md | xargs grep -H "targetVersion"
# 将要发布的版本
grep -E '^version' apps/fn-deepseek-harness/manifest
```

若**同一需求的连续修补**产生的版本已经越过 `targetVersion`，说明发版粒度过细：停下，把余下改动累积到该需求的发布里，不要继续一格一格地推。

## 版本更新时机（强制）

**修改插件或项目的功能结束后，必须用 `pnpm run version` 更新对应版本**，不允许改动落库后版本保持不动：

```bash
pnpm run version -- patch    # 按本轮变更性质选 patch / minor / major
```

一次执行会同时更新：

| 对象 | 更新内容 |
| --- | --- |
| 项目/FPK | 版本按档位递增；同步 `manifest`（version 与 desc 基线字样）、各 `package.json`、文档版本引用；打本地 Tag |
| 全部插件 | 统一到**与项目相同的目标版本**；同步发布清单、插件总览表格与全部安装命令 |

- **插件与项目永远同号**：插件直接沿用项目目标版本。这条由命令校验——若某个插件与项目不同号，命令**报错并点名**，而不是默默拉平（静默改写会让「谁在何时改了版本」无从追溯）。
- 版本提交与功能改动是**两条独立提交**：先提交功能改动，再执行 `pnpm run version` 生成版本提交，不把两者混在一条里。
- 仅文档、章程与测试用例文档的纯文档改动不需要触发版本更新。
- 该要求与 [发布检查](#发布检查) 衔接：功能结束 → `version` 更新版本 → 发布时按 [发布流程](./release.md) 走 `publish` 与 dist-tag 维护。

### 切换 DSH 基线（`major --baseline`）

DSH 升级到新基线时用 `major --baseline <版本>`，一条命令完成两件事：

```bash
pnpm run version -- major --baseline 0.2.2-rc.1
```

```text
项目与全部插件：5.11.0 → 6.0.0
DSH 基线：0.2.1-rc.2 → 0.2.2-rc.1（catalog 改写；manifest desc 与应用文档页基线字样同步）
```

它依次做：确认发布计划 → 改写 `pnpm-workspace.yaml` 里的 `@deepseek-ai/dsh` 条目 → 版本按 major +1 → 项目与全部插件同步 → manifest 描述与应用文档页的基线字样对齐新值。

**为什么必须由命令改 catalog**：`pnpm run` 会在脚本执行**之前**做一次依赖校验。如果先手工把 catalog 改成新基线（那时新版本通常还没 `pnpm install`，甚至 npm 上尚未发布），这一步就会直接失败，连命令都进不来。让 catalog 在命令内部（且在确认之后）才变化，校验看到的就是变化前的状态。

**它只改版本号与 catalog 基线行，不碰依赖**：插件 `package.json` 里对 DSH 的依赖声明保持原样。依赖升级由单独的 `pnpm install` 完成，两者职责分离——版本号要立刻跟上新基线，依赖则要等真正安装。

基线切换的完整清单还包括两件命令不做的事：同步 `apps/fn-deepseek-harness/cmd/install_callback` 的 `DSH_VERSION`（构建校验会拦截不一致），以及按[发布流程](./release.md)核对三方插件（如 `dshmarket`）的 peer 兼容版本。

### tag 不推送与非交互参数

`version` 命令支持以下参数（实现见 `tooling/fnos-dsh-cli/src/commands/version.ts`）：

| 参数 | 作用 |
| --- | --- |
| `--yes` | 跳过版本确认提示，**非交互执行**；脚本、Agent 与 CI 场景必须携带 |
| `--no-tag` | 不创建项目 Tag |
| `--no-commit` | 只更新版本文件，不创建提交 |
| `--no-push` | 兼容参数；命令内部本就硬编码 `push: false`，**任何情况下都不会推送 Tag** |
| `--baseline <版本>` | 切换 catalog DSH 基线；**仅与 major 档位搭配合法** |

规则：

- **产生的 Tag 只留在本地，不推送**。Tag 的推送由发布者按 [发布流程](./release.md) 确认后手动执行（`git push origin <tag>`），版本命令不做这件事。
- **一次只推一个 Tag，且必须显式写出 tag 名**。禁止 `git push --tags`，也禁止 `git push origin v6.0.1 v6.0.2` 这类批量推送：

  | 风险 | 后果 |
  | --- | --- |
  | 只推本次该推的那一个 | 本地可能积压多个未推 Tag（历次发布未推送），批量推会把它们一并公开 |
  | 多个 `v*` Tag 同时推 | `build-release.yml` 按 Tag 并行触发，多个 Release 几乎同时发布；GitHub 按**发布时间**决定 `Latest`，可能把低版本标成 Latest（2026-10-26 实测：v6.0.1 比 v6.0.2 晚 3 秒发布，Latest 错标到 v6.0.1） |

  推送前先看远端已有哪些：`git ls-remote --tags origin | tail`；只推本次发布的那一个：`git push origin v<版本>`。
- **推错后可纠正**：`gh api --method PATCH repos/<owner>/<repo>/releases/<id> -F make_latest=true` 把 `Latest` 重新指到正确版本（`<id>` 用 `gh api repos/<owner>/<repo>/releases/tags/<tag> --jq .id` 取）。多出来的 Release 可以保留、标为 pre-release，或连同 Tag 一并删除——删除已推送的 Tag 会影响已拉取者，需在发布记录里说明。
- 非交互场景（脚本、Agent、CI）使用 `--yes`：`pnpm run version -- patch --yes`。不带 `--yes` 时命令会在确认提示处等待输入。

## 项目与 FPK 版本

项目版本命令更新根 `package.json`、文档包 `docs/package.json`、`packages/*/package.json`、`tooling/fnos-dsh-cli/package.json`、应用 `manifest` 和 README 版本引用，并创建项目 Tag。CLI workspace 包与项目版本保持一致，避免版本命令升级项目后工具包仍停留在旧版本。文档站点的版本徽标从文档包自身的 `package.json` 读取：

```bash
pnpm run version -- patch                         # 修复：5.10.0 → 5.10.1
pnpm run version -- minor                         # 新功能：5.10.1 → 5.11.0
pnpm run version -- major --baseline 0.2.2-rc.1    # 基线变更：5.11.0 → 6.0.0
pnpm run version -- 5.10.1                         # 显式指定（纯净三段式）
```

默认生成 `chore: release v<版本号>` 提交和 `v<版本号>` Tag。Harness Manifest、文档 Manifest 示例和文档包版本会先与根项目对齐，再由版本流程统一更新。

历史注记：`5.10.0` 之前项目版本采用 FNOS-019 的「`<基础段>-<DSH 基线>.<迭代号>`」小尾巴形态（如 `5.9.0-0.2.1-rc.2.52`）；该方案已被 [FNOS-028](/requirements/FNOS-028-unified-project-version-bumpp) 取代，版本命令遇到小尾巴形态会报错并指引先完成统一。

仅修改文件时使用：

```bash
pnpm run version -- patch --no-commit --no-tag
```

## 插件版本

插件版本**随同一条统一命令一起递增**，不再有「单独升某个插件」的入口。插件直接沿用项目目标版本（同号），随后同步以下三处**副本**，让用户看到和照抄的都是实际发版版本：

1. `apps/fn-deepseek-harness/app/published-dsh-plugins.json` 中同名插件的 `version`；
2. `docs/plugins/index.md` 总览表格的版本列；
3. 各处安装命令 `dsh plugin --profile web add <包名>@<版本>` —— 插件自己的 `README.md`、对应的 `docs/plugins/<插件>.md`，以及总览页里的命令。

第 3 项是可执行的指令而不是描述文字：它若停在旧版本，用户照抄安装会拿到旧包。只改总览表格不足以避免这个问题，因此发布时一并改写，并由 `tooling/fnos-dsh-cli` 的用例断言「每个文档页的安装命令等于该插件当前版本」。

上述文件与项目版本改动落在**同一条提交**里，不留下需要手工补交的文档改动。

插件列表由 CLI 动态扫描 `plugins/` 目录发现，新增插件无需改动 CLI，会自动纳入每次发布。

### 插件版本只有一份事实来源

每个插件的版本只写在 `plugins/<插件目录>/package.json` 的 `version` 字段。`apps/fn-deepseek-harness/app/published-dsh-plugins.json` 是**副本**，由统一版本命令同步；`tooling/fnos-dsh-cli` 的构建校验只读取源码里的版本，用来证明这份副本没有和它的来源漂移，不在校验代码里重复书写版本号。

插件版本与 DSH 基线是两套独立的值：`0.2.1-rc.2` 是 DSH 运行时基线（同时锁定在 `cmd/install_callback` 与 catalog），插件在该基线上独立发布为 `5.10.0` 这样的纯净版本。因此**不要**把插件版本绑定到 `DSH_VERSION`，也不要为插件版本在校验代码里新增常量：一旦插件单独发版，被重复写下的那份值就会过期，构建会在一个本可以自动推导的字段上失败（v5.5.0 发布即为此类事故——插件已单独发版，脚本里仍写着旧基线值）。

只有无法从本仓库推导的值才作为常量维护：`dshmarket` 是第三方包，注册表版本就是契约本身；`DSH_VERSION` 与 `PNPM_VERSION` 属于 DSH 基线，判断依据是它们与 `cmd/install_callback`、catalog 之间的**一致性**。

## 发布检查

### 先回答：现在该不该发版

执行任何版本命令之前，逐条回答。**任一条答不上来就不要发**：

| 问题 | 不合格的信号 |
| --- | --- |
| 这次发布覆盖哪些需求编号？ | 答不出编号，或涉及多个不相关需求 → 拆开或延后 |
| 用户能感知到的变化，用一句话怎么说？ | 只能说「改了实现」「调了样式」→ 不该发版，继续累积 |
| 这些改动是否都是同一需求的首次交付？ | 是同一需求的第 N 次修补 → 累积到收口再发 |
| 若是装机验证需要换号：用的是 `patch` 吗？ | 按改动性质重算了 `minor`/`major` → 改回 `patch` |
| 推进后的版本是否还落在该需求的 `targetVersion` 上？ | 已越过 → 发版粒度过细，停下累积 |

### 再执行：发版步骤

1. 确认工作区没有需要保留的未提交改动（版本命令入口也有硬守卫：脏工作区直接拒绝发版）。
2. 确认功能改动已完成 `pnpm run version` 版本更新（见[版本更新时机](#版本更新时机强制)）。
3. 按[发布批次](#发布批次一次发布覆盖一批变化不是一个提交)判定这次是否该发版、用哪个档位，然后执行 `pnpm run version -- <档位>`。
4. 检查版本文件和提交。
5. 推送提交，触发对应的 CI/发布流程。
6. **推 Tag 前校验 `apps/fn-deepseek-harness/app/published-dsh-plugins.json` 里每个插件版本都已在
   registry 存在**（命令与判据见[发布前必须确认清单里的插件版本已发布到 npm](./release.md#发布前必须确认清单里的插件版本已发布到-npm-强制性)）：
   FPK 是瘦包，版本没发到 npm 会让安装回调在插件步骤直接失败。缺失即**打回发布**，不推 Tag。
7. **推送 Tag 前确认远端已有列表，一次只推一个**（`git push origin v<版本>`）；推送后核对 `gh release list` 的 `Latest` 是否落在最高版本上——多个 Tag 同时推会让 CI 并行建 Release 并按发布时间错标 `Latest`。
8. 插件发布前运行对应插件的 `check`，再使用 `pnpm run publish` 发布。
9. 插件发布前在本地用 `pnpm pack` 核对产物文件清单，确认本轮改动项确实进入 tarball（见[发布前必须在本地验证产物](./release.md#发布前必须在本地验证产物-不要靠发布后回看-强制性)）。该步骤在 `publish` **之前**完成：一旦版本进入公开 registry，缺内容只能靠补发新版本修正，补发的中间版本无法撤回。

### 版本发布后要维护什么

`pnpm run version` 会**自动**改这些地方，不需要手工跟进：

| 类别 | 自动同步的内容 |
| --- | --- |
| 版本字段 | 根 `package.json`、`docs/package.json`、`packages/*`、`tooling/fnos-dsh-cli`、`apps/fn-deepseek-harness/manifest` |
| 基线字样 | `manifest` desc 的「运行基线为 DSH `<基线>`」、`docs/apps/fn-deepseek-harness.md` 的「DSH 基线」行 |
| 插件副本 | `apps/fn-deepseek-harness/app/published-dsh-plugins.json` 的版本字段 |
| 文档版本 | `docs/development/manifest.md` 的当前版本引用、各插件文档与总览页的安装命令 |
| Git | 一条 `chore: release v<版本>` 提交 + 本地 Tag（不推送） |

**它不会改 `manifest` 的 `desc` 与 `changelog` 的其余内容**——这两项是给用户看的**内容**，机器推不出该写什么，必须人工维护（基线字样除外，见上表）。

#### `manifest` 的 `desc` 与 `changelog`

`apps/fn-deepseek-harness/manifest` 里：

| 字段 | 写什么 | 更新时机 |
| --- | --- | --- |
| `desc` | 应用简介，支持 HTML 富文本；描述**当前功能**，不是本轮改动；其中「运行基线为 DSH `<基线>`」字样由版本命令自动对齐 catalog | 功能或定位变化时 |
| `changelog` | **本轮**变更摘要：新功能、修复、行为变化 | 每次功能完成时 |

`changelog` 的口径要求（与文档站保持一致，读者在应用中心和文档站看到同一件事）：

- **写用户能感知的变化**，不写内部重构、依赖升级、测试改动这类对使用者无影响的内容。
- **与需求文档的变更记录同源**：本轮改了哪几条需求，`changelog` 就概括那几条的**结果**，不逐条罗列实现细节。
- **覆盖本轮全部对外变化**：项目版本与插件版本在同一次发布里推进，插件的行为变化也要写进 `changelog`，否则用户只看到应用版本变了却不知道插件改了什么。
- 中文，一到三句话；涉及不兼容或需要用户操作的变化（如需要重新授权、需要改配置）必须写明。

维护节奏（两处各管一段，不重复劳动）：

1. **功能完成时**：更新 `changelog` 与 `desc`，与需求文档的变更记录一起写；此时不改版本号。
2. **发版时**：跑 `pnpm run version`，它只改版本字段与基线字样，**不覆盖**第 1 步写好的内容；提交前用 `git diff` 确认 `changelog` 仍是本轮要发布的那段。

所以正常顺序是「先写内容、再推版本」，两条提交分开（功能提交 + 版本提交），见[版本更新时机](#版本更新时机强制)。

### 装机验证时提升版本

在真实 fnOS 设备上验证安装或升级时，**用统一版本命令**推进一个迭代号，不要手工只改 `manifest`：

```bash
pnpm run version -- patch      # 项目与全部插件一起推进，并生成版本提交
pnpm run build -- --fpk --app fn-deepseek-harness --bundle-dsh-plugins
```

- **为什么必须换号**：fnOS 应用中心按版本号判定是否需要安装。版本与已装应用相同时，手动安装会被当作同版本处理，直接弹「已安装相同或更高版本」而拒绝，走不到安装回调。
- **为什么不用手工改 `manifest`**：应用版本在 `manifest`、根 `package.json`、`docs/package.json` 与 `packages/*` 中都有副本。实测只改 `manifest` 一行**也能打包成功**（构建不校验这几处是否一致），产出的 FPK 版本会与仓库其它版本文件**漂移**；下一次 `pnpm run version` 以后者为准，又把 `manifest` 覆盖回去，前一次的号就白改了。走命令则各处一次对齐，并留下可追溯的版本提交。
- **验证后不要手工回退**：该版本本身就是一次正常发布的迭代，继续往前走即可；确实要丢弃时用 `git revert` 回退整条版本提交，不要只改回某几个文件。

> 插件版本由同一条命令一起推进，**不要单独手工改**：`app/published-dsh-plugins.json` 与插件源码版本不一致时构建会失败（构建校验这份副本没有漂移）。走 `pnpm run version` 则会一次对齐两处。

### 更新 DSH 基线时必须同步三方插件版本

DSH 运行时对插件做兼容性门禁：插件 `peerDependencies` 里的 `@deepseek-ai/dsh*` 必须满足当前运行时版本，否则安装被**明确拒绝**（`installation rejected: Plugin <name> is incompatible with dsh <版本>`）。第三方插件的 peer 范围由上游维护，通常滞后于我们的重锚定。

因此**每次更新 DSH 版本（`DSH_VERSION`）时，必须同步检查并更新三方插件的版本**，不能只改基线：

1. 对清单里的每个三方插件（当前为 `dshmarket`）查询其可用版本，并核对目标版本的 `peerDependencies` 是否已覆盖新的 DSH 版本：
   ```bash
   npm view <包名> versions --json
   npm view <包名>@<目标版本> peerDependencies --json
   ```
2. 选定**已声明支持新基线**的版本，更新 `apps/fn-deepseek-harness/app/published-dsh-plugins.json` 中该插件的 `version`。
3. 在 FPK 安装或升级的真机验证中确认该插件安装通过；若被门禁拒绝，说明版本选错或该插件尚无兼容版本，需回到第 1 步。
4. 若上游确实没有兼容版本，只有两条路：等待上游发布，或在安装回调中显式授予精确版本豁免（`dsh plugin allow-version ... --accept-risk`）——后者是**接受风险**的例外，必须在变更记录中说明原因与回滚方式。

**为什么写进规范**：`dshmarket@1.66.3` 在 DSH `0.2.0-rc.2` 上被门禁拒绝，导致 FPK 安装最后一步失败。它的 peer 范围停留在 `^0.1.x`；上游在 `1.66.11` 补上了 `|| ^0.2.0-rc.1` 才兼容。这类失败发生在**安装期的最后一步**，前面步骤全部成功，因此很容易在本地测试中被漏掉，只有真机安装才会暴露。
