# 版本管理

版本命令由根目录 `fnos-dsh-cli` CLI 暴露，实现在 `tooling/fnos-dsh-cli` workspace。项目/FPK 版本通过 [`bumpp`](https://github.com/antfu-collective/bumpp) 管理；插件版本由 CLI 直接更新并提交。项目/FPK 版本与插件版本是相互独立的两套发布流程，插件不会被项目版本命令隐式修改。

## 项目与 FPK 版本

项目版本命令更新根 `package.json`、文档包 `docs/package.json`、`packages/*/package.json`、`tooling/fnos-dsh-cli/package.json`、应用 `manifest` 和 README 版本引用，并创建项目 Tag。CLI workspace 包与项目版本保持一致，避免版本命令升级项目后工具包仍停留在旧版本。文档站点的版本徽标从文档包自身的 `package.json` 读取：

```bash
pnpm run version -- project patch
pnpm run version -- project minor
pnpm run version -- project 5.3.0
```

默认生成 `chore: release v<版本号>` 提交和 `v<版本号>` Tag。Harness Manifest、文档 Manifest 示例和文档包版本会先与根项目对齐，再由版本流程统一更新。

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
2. 根据发布目标选择 `version -- project` 或 `version -- plugin`（插件可复选）。
3. 检查版本文件和提交。
4. 推送提交，触发对应的 CI/发布流程。
5. 插件发布前运行对应插件的 `check`，再使用 `pnpm run publish` 发布当前 `next` dist-tag。

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
