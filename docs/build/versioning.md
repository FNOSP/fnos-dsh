# 版本管理

版本命令由根目录 `fnos-dsh-cli` CLI 暴露，实现在 `tooling/fnos-dsh-cli` workspace。项目/FPK 版本通过 [`bumpp`](https://github.com/antfu-collective/bumpp) 管理；插件版本由 CLI 直接更新并提交。项目/FPK 版本与插件版本是相互独立的两套发布流程，插件不会被项目版本命令隐式修改。

## 版本更新时机（强制）

**修改插件或项目的功能结束后，必须用 `pnpm run version` 更新对应版本**，不允许改动落库后版本保持不动：

| 改动对象 | 命令 | 说明 |
| --- | --- | --- |
| 插件（`plugins/*` 的代码、样式、配置、契约） | `pnpm run version -- plugin <别名> <patch\|minor\|major>` | 在改动提交之后执行；命令会同步发布清单、总览表格与全部安装命令 |
| 项目（应用、FPK、网关、文档、CLI 等仓库级改动） | `pnpm run version -- project <patch\|minor\|major>` | bumpp 统一更新并打 Tag |

- 版本档位按改动性质选择：修复与样式微调用 `patch`，新功能用 `minor`，破坏性变更用 `major`；拿不准时用 `patch`。
- 版本提交与功能改动是**两条独立提交**：先提交功能改动，再执行 `pnpm run version` 生成版本提交，不把两者混在一条里。
- 仅文档、章程与测试用例文档的纯文档改动不需要触发版本更新。
- 该要求与 [发布检查](#发布检查) 衔接：功能结束 → `version` 更新版本 → 发布时按 [发布流程](./release.md) 走 `publish` 与 dist-tag 维护。

### tag 不推送与非交互参数

`version` 命令支持以下参数（实现见 `tooling/fnos-dsh-cli/src/commands/version.ts`）：

| 参数 | 作用 |
| --- | --- |
| `--yes` | 跳过版本确认提示，**非交互执行**；脚本、Agent 与 CI 场景必须携带 |
| `--no-tag` | 不创建项目 Tag（`project` 命令） |
| `--no-commit` | 只更新版本文件，不创建提交 |
| `--no-push` | 兼容参数；命令内部本就硬编码 `push: false`，**任何情况下都不会推送 Tag** |

规则：

- **产生的 Tag 只留在本地，不推送**。Tag 的推送由发布者按 [发布流程](./release.md) 确认后手动执行（`git push origin <tag>`），版本命令不做这件事。
- 非交互场景（脚本、Agent、CI）使用 `--yes`：`pnpm run version -- project patch --yes`。不带 `--yes` 时命令会在确认提示处等待输入。
- 插件版本命令不创建 Tag，因此没有推送 Tag 的问题；它同样支持 `--yes` 跳过确认。

## 项目与 FPK 版本

项目/FPK 版本采用**固定前缀 + 迭代号**方案（[FNOS-019](/requirements/FNOS-019-fpk-version-scheme)）：

```text
5.9.0-0.2.1-rc.2.5
└─┬─┘ └───┬───┘ └┬┘
  │       │      └─ 应用迭代号：每次发布 +1，其余两段不动
  │       └──────── DSH 运行时基线：取自 pnpm-workspace.yaml 的 catalog
  └──────────────── 固定基础版本：永不移动
```

| 段 | 含义 | 由谁维护 |
| --- | --- | --- |
| `5.9.0` | 应用基础版本 | **固定不变**；被改动时版本命令直接报错 |
| `0.2.1-rc.2` | DSH 运行时基线 | 自动跟随 `pnpm-workspace.yaml` 中 `'@deepseek-ai/dsh'` 的版本 |
| 末尾整数 | 应用迭代号 | 每次发布 +1 |

项目版本命令更新根 `package.json`、文档包 `docs/package.json`、`packages/*/package.json`、`tooling/fnos-dsh-cli/package.json`、应用 `manifest` 和 README 版本引用，并创建项目 Tag。CLI workspace 包与项目版本保持一致，避免版本命令升级项目后工具包仍停留在旧版本。文档站点的版本徽标从文档包自身的 `package.json` 读取：

```bash
pnpm run version -- project patch                  # 迭代号 +1
pnpm run version -- project 5.9.0-0.2.2-rc.1.0     # 显式指定（如 DSH 基线升级时的首版）
```

默认生成 `chore: release v<版本号>` 提交和 `v<版本号>` Tag。Harness Manifest、文档 Manifest 示例和文档包版本会先与根项目对齐，再由版本流程统一更新。

两条与直觉不同的规则：

- **档位关键字只影响迭代号**。`patch`、`minor`、`major` 在此方案下语义相同，都是「迭代号 +1」——因为前三段必须固定，档位无法再作用于它们。
- **基线变化时迭代号不重置**。DSH 基线升级后，新版本号的迭代号在上一次的值上继续递增，不回到 0。版本号只需单调递增；重置会让新号在排序上退回旧位置，设备判为降级而拒绝安装。

整串在 semver 中是**预发布版本**（`-` 之后为 prerelease），按语义化版本排序时小于同号正式版 `5.9.0`。本方案不发布 `5.9.0` 正式版，比较只发生在两个预发布版本之间，此时末尾迭代号能正确分出先后。

仅修改文件时使用：

```bash
pnpm run version -- project patch --no-commit --no-tag
```

## 插件版本

插件版本可选择单个插件，或在交互提示中复选多个插件；选择版本时支持 `patch`、`minor`、`major`、`prerelease` 以及 bumpp 风格的 `custom ...` 自定义版本输入。脚本把所选插件的 `package.json` 更新到同一目标版本，并同步以下三处**副本**，让用户看到和照抄的都是实际发版版本：

1. `apps/fn-deepseek-harness/app/published-dsh-plugins.json` 中同名插件的 `version`；
2. `docs/plugins/index.md` 总览表格的版本列；
3. 各处安装命令 `dsh plugin --profile web add <包名>@<版本>` —— 插件自己的 `README.md`、对应的 `docs/plugins/<插件>.md`，以及总览页里的命令。

第 3 项是可执行的指令而不是描述文字：它若停在旧版本，用户照抄安装会拿到旧包。只改总览表格不足以避免这个问题，因此发布时一并改写，并由 `tooling/fnos-dsh-cli` 的用例断言「每个文档页的安装命令等于该插件当前版本」。上述文件都在**同一条提交**里：`version -- plugin` 把插件 `package.json`、发布清单、总览表格与所有安装命令一次 `git add` 后提交，不留下需要手工补交的文档改动。插件版本更新不调用 `bumpp`，多选时直接创建一条合并提交，不创建插件 Git Tag：

```bash
# 直接指定单个插件
pnpm run version -- plugin codex patch
pnpm run version -- plugin fnos patch
pnpm run version -- plugin showcase patch

# 交互选择（插件列表为复选框，可多选，再选择版本类型）
pnpm run version -- plugin
```

插件列表由 CLI 动态扫描 `plugins/` 目录发现，新增插件无需改动 CLI。每个插件的别名为包名去掉 `dsh-` 前缀后的部分（如 `@tnnevol/dsh-fnos` → `fnos`、`@tnnevol/dsh-codebuddy` → `codebuddy`），也可直接使用完整包名。历史简称 `codex`、`showcase` 仍保留兼容。

插件版本命令不会修改根项目、共享包、FPK Manifest 或未选中的插件；默认只创建版本提交，不创建 Git Tag。使用 `--no-commit` 可只执行文件更新；`--no-tag` 对插件版本命令保持兼容但无额外作用。脚本默认不会自动 push，推送由发布者确认后执行。

## 发布检查

1. 确认工作区没有需要保留的未提交改动。
2. 确认功能改动已完成 `pnpm run version` 版本更新（见[版本更新时机](#版本更新时机强制)）。
3. 根据发布目标选择 `version -- project` 或 `version -- plugin`（插件可复选）。
4. 检查版本文件和提交。
5. 推送提交，触发对应的 CI/发布流程。
6. 插件发布前运行对应插件的 `check`，再使用 `pnpm run publish` 发布当前 `next` dist-tag。
7. 插件发布前在本地用 `pnpm pack` 核对产物文件清单，确认本轮改动项确实进入 tarball（见[发布前必须在本地验证产物](./release.md#发布前必须在本地验证产物-不要靠发布后回看-强制性)）。该步骤在 `publish` **之前**完成：一旦版本进入公开 registry，缺内容只能靠补发新版本修正，补发的中间版本无法撤回。

### 插件版本只有一份事实来源

每个插件的版本只写在 `plugins/<插件目录>/package.json` 的 `version` 字段。`apps/fn-deepseek-harness/app/published-dsh-plugins.json` 是**副本**，由 `version -- plugin` 同步；`tooling/fnos-dsh-cli` 的构建校验只读取源码里的版本，用来证明这份副本没有和它的来源漂移，不在校验代码里重复书写版本号。

插件版本与 DSH 基线是两套独立的值：`0.1.7-rc.2` 是 DSH 运行时基线（同时锁定在 `.github/config/dsh-native-0.1.7-rc.2.env` 与 `cmd/install_callback`），插件可以在该基线上独立发布为 `0.1.7-rc.2.1` 这样的版本。因此**不要**把插件版本绑定到 `DSH_VERSION`，也不要为插件版本在校验代码里新增常量：一旦插件单独发版，被重复写下的那份值就会过期，构建会在一个本可以自动推导的字段上失败（v5.5.0 发布即为此类事故——插件已到 `0.1.7-rc.2.1`，脚本里仍写着 `0.1.7-rc.2`）。

只有无法从本仓库推导的值才作为常量维护：`dshmarket` 是第三方包，注册表版本就是契约本身；`DSH_VERSION` 与 `PNPM_VERSION` 属于 DSH 基线，判断依据是它们与 `cmd/install_callback`、native 配置之间的**一致性**。

### 装机验证时临时提升 FPK 版本

在真实 fnOS 设备上验证安装或升级时，先把 `apps/fn-deepseek-harness/manifest` 的 `version` 临时
改成下一个补丁号（`5.5.x` → `5.5.x+1`），验证完成后再决定是否保留：

- **为什么需要**：fnOS 应用中心按版本号判断是否需要安装。版本与已装应用相同时，手动安装会被
  当作同版本处理，无法走完整的安装/升级链路；只有版本更高才会真正执行安装回调。
- **怎么改**：只改 `manifest` 的 `version` 一行。应用版本只从 `manifest` 读取
  （`tooling/fnos-dsh-cli/src/config/workspace.ts`），不需要同步其他地方。
- **为什么写在规范里**：这是**临时**手段，不是发布流程的一部分。正式发版仍通过
  `pnpm run version -- project <patch|minor|major>` 由 `bumpp` 统一更新根 `package.json`、
  文档包、`packages/*`、`tooling/fnos-dsh-cli`、`manifest` 与 README 版本引用并打 Tag。
- **收尾**：验证结束后，如果该版本要进入正式流程，用 `version -- project patch` 让各处版本
  重新对齐；如果只是本地验证，把 `manifest` 改回原版本，不要留下与 `package.json` 不一致的
  应用版本进入发布。

> 注意：插件版本（`plugins/*/package.json`）在验证时**不需要**跟着改。插件版本由
> `version -- plugin` 独立管理，且构建会校验 `app/published-dsh-plugins.json` 与插件源码一致；
> 手工改插件版本会让构建失败。

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
