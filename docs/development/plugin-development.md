# 插件开发

`plugins/*` 中维护 DeepSeek Harness 的 harness 插件。插件开发前加载 [`$dsh`](https://github.com/tnnevol/skills/tree/main/skills/dsh) Skill，确认目标 DSH 版本、Profile、Host/Client 边界、Slot、Service 和 Bundle 约束。

```bash
# 安装或更新 Skill
pnpx skills add tnnevol/skills --skill dsh -g
```

## 实现边界

:::warning 插件实现边界

官方 Harness 源码只用于查阅和调试，**不直接修改**。插件的 `package.json`、Peer Dependency、兼容声明和 `@deepseek-ai/*` 依赖必须与目标 DSH 版本一致。

新增注册、定时器、网络连接或观察器时，必须提供可逆清理，并验证 HMR、重复注册和真实 Profile 加载。

:::

## 基础检查

```bash
# 仓库内 CLI，版本与 FPK 运行时基线一致
pnpm exec dsh --version

# 检查所有 harness 插件和共享包
pnpm run check -- --packages --plugins
```

需要查看组合配置时（下列命令使用全局 `dsh`；要检查仓库内 profile，请先按[本地 DSH Web](./local-dsh-web) 设置 `DSH_HOME`）：

```bash
dsh --profile web --dump-config
dsh --profile web --dump-config | grep -n -C 3 'dsh-fnos'
```

## 构建、启动和检查

```bash
# 交互选择 harness 插件、FPK 或文档
pnpm run build

# 构建指定 harness 插件
pnpm run build -- --plugin fnos

# 启动指定 harness 插件的 watch
pnpm run start -- --plugin fnos

# 检查所有 harness 插件和共享包
pnpm run check -- --packages --plugins
```

插件的 `build`、`typecheck`、`test` 和 `check` 写在各自的 `package.json`。Turbo 会根据 workspace 依赖先处理 `@tnnevol/dsh-semi-ui`，**不要在根脚本中手工复制依赖步骤**。

## 本地开发

插件的 `dev` 任务是常驻的 `tsdown --watch`，被 Turbo 通过 `start` 间接调度。它与共享包的关系有一条硬约束：

插件 bundle 需要解析 `@tnnevol/dsh-semi-ui/lib/index.js`。如果两边并行 `tsdown`，`dsh-semi-ui` 的 `clean`（默认删除 `lib/`）会让插件侧解析失败并报 `Could not resolve '@tnnevol/dsh-semi-ui'`。

因此共享包的 `dev` 是一次性构建（包内 `turbo.json` 覆盖 `persistent: false`），先完成；插件自己的 `dev` 保持常驻，并在 `interruptible: true` 下于依赖变化时被 `turbo watch` 重启。调度细节见 [Turbo 任务](./turbo-tasks)。

## 测试布局

插件的单元测试集中放在 workspace 同级 `tests/`，通过 `test` 调用该 workspace 的 `vitest.config.ts`。新增测试应放入对应 workspace 的 `tests/`，按被测模块组织文件；不要把跨 workspace 的测试复制到根目录，也不要把测试混入 `apps/` 下的 fnOS 应用目录。

## 新增插件的登记

新增一个插件时，**只在插件市场索引的源列表登记一次**，不要往 `apps/fn-deepseek-harness/app/published-dsh-plugins.json` 里加条目。

### 唯一的登记点：`docs/public/plugins/market/plugins.txt`

在 `docs/public/plugins/market/plugins.txt` 里加一行 npm 包名，然后重新生成索引：

```text
@tnnevol/dsh-new-plugin
```

```sh
REPO=$(git rev-parse --show-toplevel)
cd "$DSH_DESKTOP_APP_DIR/apps/plugin-market-generator"
npx tsx src/bin.ts \
    --input "$REPO/docs/public/plugins/market/plugins.txt" \
    --output "$REPO/docs/public/plugins/market/index.json" \
    --cache "$REPO/tmp/plugin-market-cache" \
    --title "飞牛 fnOS DSH 插件" \
    --description "为飞牛 fnOS 维护的 DSH 插件：模型提供方、搜索故障转移、浏览器自动化与系统集成。"
```

`index.json` 是**生成物**，不手改：它含 `publishTimestamp`、`engines`、图标 base64 等只能从 npm tarball 得到的字段，手工写入会不准，下次生成也会覆盖。生成前插件必须**已在 npm 发布**，否则生成器读不到它。

### 为什么不再登记到 `published-dsh-plugins.json`

该文件已经收敛为**FPK 内置插件清单**：它决定「哪些插件随应用安装包一起分发」，而不是「仓库里有哪些插件」。两者不是一回事——

| 文件 | 回答的问题 | 谁维护 |
| --- | --- | --- |
| `docs/public/plugins/market/plugins.txt` | 仓库对外提供了哪些插件 | 新增插件时登记一次 |
| `docs/public/plugins/market/index.json` | 每个插件的标题、描述、图标、可用版本 | 生成器产出 |
| `apps/fn-deepseek-harness/app/published-dsh-plugins.json` | 哪些插件**随 FPK 内置**、各自版本 | 版本命令维护版本；内置与否是产品决定 |

因此新增插件默认**不进** `published-dsh-plugins.json`，用户从插件市场自行安装。只有确实要随应用一起分发的插件才改这份清单，并同时在 `tooling/fnos-dsh-cli/src/commands/build.ts` 的 `FPK_REQUIRED_BUNDLED_PLUGIN_NAMES` / `FPK_OPTIONAL_BUNDLED_PLUGIN_NAMES` 里登记——漏登记会在构建期报错并点名。

### 新增插件的最小清单

| 事项 | 位置 |
| --- | --- |
| 插件源码与 `package.json`（版本、`dsh.bundle` 声明、兼容范围） | `plugins/<插件名>/` |
| 面向用户的说明页 | `docs/plugins/<插件名>.md` + `docs/.vitepress/config.mts` 菜单 |
| 市场元数据（标题、描述、关键词、图标） | 插件 `package.json` 的 `displayName`、`keywords`、`icon` 与 `locale/` |
| 市场索引登记 | `docs/public/plugins/market/plugins.txt` |
| 版本 | 由 `pnpm run version` 统一管理，不要手写 |

插件目录会被自动发现（`tooling/fnos-dsh-cli/src/config/targets.ts` 扫描 `plugins/`），不需要在代码里登记名称。

## 内置 Skill 的上游同步检查（强制）

内置 skill 的插件（当前为 `@tnnevol/dsh-midscene`）在**每次开发前**必须检查内置 skill 是否有上游更新。理由：内置 skill 是 agent 理解该领域的**唯一权威入口**，上游修了错误或补了新 API 而插件还带旧版，agent 会照着过期资料干活，且这种偏差不会以任何方式报错。

**检查对象与来源**

| 插件内置 skill | 上游 | 检查方式 |
| --- | --- | --- |
| 6 个平台技能（browser / computer / android / ios / harmony / vitest-midscene-e2e） | `web-infra-dev/midscene-skills` | `git -C <上游检出> log -1 --format=%H`，与 `skills/SOURCE.md` 登记的提交比对 |
| `midscenejs` | `tnnevol/skills`（`skills/midscenejs`） | 同上 |

**检查步骤**

```bash
# 1) 取上游当前版本（两处上游都要查）
git clone --depth 1 https://github.com/web-infra-dev/midscene-skills.git /tmp/midscene-skills
git -C /tmp/midscene-skills log -1 --format=%H
git clone --depth 1 git@github.com:tnnevol/skills.git /tmp/skills
git -C /tmp/skills log -1 --format=%H

# 2) 与插件内登记的提交比对（skills/SOURCE.md 的「上游提交」一行）
grep -n "上游提交" plugins/dsh-midscene-plugin/skills/SOURCE.md
```

**比对结果的处理**

| 情况 | 处理 |
| --- | --- |
| 提交一致 | 无需动作，在本次开发的记录里说明「已核对，无更新」 |
| 有更新 | 按 `skills/SOURCE.md` 的「同步方式」整目录覆盖（**不需要重新施加补丁**） |
| 无法访问上游 | 如实记录「未能核对」及原因，不要假定无更新 |

**内置技能不得修改**：技能文件必须与上游**逐字节一致**，这样升级时整目录覆盖即可、且可用哈希核对。**本环境的模型约束不写在技能文件里**，而是由 `src/host/skills.ts` 的 `BRIDGE_PRELUDE` 在分发时注入（官方技能教 agent 去申请第三方 API key，与「本插件用 DSH 已有模型」冲突，故在分发内容前加一段环境说明）。把约束写进文件就又是一份需要每次同步时重新施加的补丁。

因此 `plugins/*/skills/**` 已从仓库 lint 中排除——它们是第三方原文，改格式即等于改动上游。

同步完成后更新 `skills/SOURCE.md` 的**上游提交、同步日期、各文件 sha256**：哈希由守卫测试核对，漏登记会报红。

## 插件截图

插件功能截图服务于两处：DSH 文档站页面（`docs/plugins/`）与插件市场收录（awesome-dsh-plugin、dsh-market 读取仓库内 `screenshots.json`）。截图只维护**一份**，统一放 `docs/public/images/plugins/<插件名>/`。

约束：

- `plugins/<插件名>/screenshots.json` 声明 1–8 张截图，内容为 **GitHub 托管的 https 绝对 URL**（`https://raw.githubusercontent.com/FNOSP/fnos-dsh/main/docs/public/images/plugins/...`）。市场与收录流程不读 npm 包，截图不会进入 `npm publish`（各插件 `files` 白名单不含 `screenshots.json` 与图片）。
- **不要**在插件子目录内再复制一份 `assets/` 截图，也不要用 `../` 相对路径引用插件目录之外的文件——收录校验会拒绝相对路径跳出插件目录。
- 依赖 fnOS 宿主环境的插件（如 `@tnnevol/dsh-fnos`）在真机上补拍截图后再声明。
- 发布前核对描述与截图不含账号昵称、手机号、账号 ID 等敏感信息；用浏览器演示截图时先在 DOM 层脱敏，不改插件代码。
- 移动或改名 `docs/public/images/plugins/` 下的图片时，必须同步更新对应插件的 `screenshots.json`——绝对 URL 在源文件移动后会静默失效。

## 相关页面

- [插件 UI 规范](/charter/plugin-ui-standards)
- [本地 DSH Web](./local-dsh-web)
- [Turbo 任务](./turbo-tasks)
- [路径与编码](./conventions)
- [Harness 插件总览](/plugins/)

---

| 日期 | 变更 |
| --- | --- |
| 2026-10-13 | 「内置 Skill 的上游同步检查」按新约定修订：内置全部 6 个官方平台技能 + `midscenejs`，且技能文件与上游**逐字节一致、不再打补丁**；模型约束改由 `BRIDGE_PRELUDE` 在分发时注入。 |
