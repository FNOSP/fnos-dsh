---
title: 测试用例文档规范
description: fnOS DSH 测试用例板块的编号、目录、生成时机、用例格式与结果回填规则。
---

# 测试用例文档规范

测试用例文档回答：**怎么验、验了什么、结果如何、暴露了哪些问题、最终结论是什么**。它与需求文档（做什么）、计划文档（怎么做）并列，构成 SDD 的第三份产物。

## 与需求和计划的边界

| 内容 | 需求文档 | 计划文档 | 测试用例文档 |
| --- | --- | --- | --- |
| 验收条件（什么算完成） | 必须 | 只引用 | 只引用，不重定义 |
| 任务与执行顺序 | 不写 | 必须 | 不写 |
| 用例设计（步骤、预期、优先级） | 不写 | 不写 | 必须 |
| 测试执行结果 | 不写 | 不写 | 必须 |
| 测试发现的 Bug 与状态 | 不写 | 不写 | 必须 |
| 最终测试结论 | 只写验收完成状态 | 不写 | 必须 |

- 需求和计划之间通过功能编号、验收编号建立关系；测试用例文档通过**需求编号（FNOS-###）**关联到对应需求和计划，不复制三者正文。
- **计划文档不再包含测试用例相关内容**：计划的「测试、打包、发布和回滚」章节只描述验证层次、环境和回滚方式，不展开具体用例表；用例统一回填到本板块的测试用例文档。

## 编号与关联规则

测试用例文档**复用需求编号**，不另设编号体系：

| 对象 | 格式 | 示例 |
| --- | --- | --- |
| 测试用例文档 | `FNOS-###`（与需求同号） | `FNOS-009` |
| 用例 ID | `TC-` + 三位顺序号，文档内连续 | `TC-001` |
| 用例与验收条件关联 | 用例行标注覆盖的 `<功能 ID>-AC-##` | `FNOS-009-11-AC-01` |
| Bug 记录 | `BUG-` + 两位顺序号，文档内连续 | `BUG-01` |

- 一个需求编号对应一篇测试用例文档；文档内按功能编号（`FNOS-###-##`）分章节组织用例。
- 测试用例文档必须在其元数据中链接对应的需求文档与计划文档；需求文档、计划文档在「关联」元信息中互链时按现有规范执行，不强制回改已完成文档。

## 文件位置和命名

测试用例文档统一放在 `docs/tests/`，文件名使用：

```text
FNOS-###-需求主题.md
```

与 `docs/requirements/`、`docs/plans/` 的命名保持一致，便于三份文档按编号对照。

## 固定元数据

```yaml
---
id: FNOS-009
title: FNOS-009 测试用例
description: FNOS-009 DSH 0.2.0-rc.2 插件适配的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-009-dsh-020-rc2-adaptation
plan: /plans/PLAN-FNOS-009-dsh-020-rc2-adaptation
status: 规划中
lastVerified: 2026-09-30
verifiedAt: 2026-09-30
---
```

| 字段 | 要求 |
| --- | --- |
| `id` | 与需求编号一致 |
| `title` / `description` | 必填，一级标题与 `title` 一致 |
| `requirement` | 对应需求文档的站点链接 |
| `plan` | 对应计划文档的站点链接 |
| `status` | 测试整体状态：规划中 / 执行中 / 通过 / 部分通过 / 未通过 |
| `lastVerified` | SDD 追踪必填，`YYYY-MM-DD` |
| `verifiedAt` | 最近一次执行日期 `YYYY-MM-DD` |

## 固定章节

每篇测试用例文档按以下顺序组织：

1. **测试范围与需求分析**：被测对象、覆盖的功能编号、关键风险点；资料不足处用 `❓` 列出。
2. **测试环境**：按功能列出目标环境（DSH Web / DSH Desktop / 真实 NAS / 文档站），与需求的验收环境范围一致。
3. **测试用例**：按功能编号分节，用例遵循统一的用例模板（见下）。
4. **测试执行结果**：用例执行情况汇总表（通过 / 失败 / 阻塞 / 未执行）。
5. **Bug 记录**：测试产出的缺陷清单与状态。
6. **测试结论**：需求编号整体的最终结果与遗留风险。

## 测试环境执行方式

目标环境的执行载体按插件类型固定，写用例与回填执行结果时按此选择：

| 被测对象 | 执行环境 | 执行方式 |
| --- | --- | --- |
| fnOS 插件（`dsh-fnos`）及依赖 fnOS 宿主桥接、NAS 文件能力、安装/升级生命周期的功能 | 真实 fnOS NAS | 见[真实 NAS 测试](#真实-nas-测试)，证据按[验收证据规范](../validation/README.md)登记 `docs/validation/` |
| 其他 DSH 插件（Codex Auth、CodeBuddy、Semi UI Showcase 等）与插件 UI 功能 | **DSH Web 与 DSH Desktop（至少两者）** | Web：`pnpm run start -- --web`；Desktop：在安装的 DSH Desktop 客户端中加载待测插件版本后人工走查（见下） |
| 纯文档与构建产物 | 文档站构建环境 | `pnpm run build -- --docs` 与 `git diff --check` |

**兼容基线**：除 fnOS 插件只需兼容真实 NAS 外，其他 DSH 插件**至少同时兼容 DSH Web 与 DSH Desktop**；测试用例必须覆盖两个客户端，只记录单一客户端结果不构成该插件的完成结论。

**fnOS 插件（`@tnnevol/dsh-fnos`）以真实 NAS 为唯一验收环境**：该插件的功能（授权目录、文件选择与打开、会话日志导出、主题跟随、`/fn` 引用选择树等）都建立在 fnOS 宿主桥接与 NAS 文件能力之上，脱离 NAS 无法执行。因此：

- **真实 NAS 走查通过即该插件通过**，不要求在 DSH Web 或 DSH Desktop 上复验，也不因缺少这两个客户端的结果而视为未完成；
- 只要功能的实现落在 `plugins/dsh-fnos-plugin/` 且依赖 fnOS 桥接，就按本条规定登记为 NAS 验收，即使它表现为 DSH 界面里的控件（例如输入区的 `/fn` 引用选择树）；
- 反之，不依赖 fnOS 桥接、可脱离 NAS 运行的部分（如纯 UI 组件、共享包），仍按上表要求覆盖 Web 与 Desktop。

### DSH Web 本地测试

- **启动命令**：`pnpm run start -- --web`（需要同时 watch 插件时加 `--plugin`，详见[本地 DSH Web](../development/local-dsh-web.md)）；不要手工另起 DSH 进程。
- **`DSH_HOME` 必须指向项目的 `.dsh` 目录**：CLI 的 `start --web` 已自动注入（`<repo>/.dsh`），手工执行 `dsh` 命令核对配置时同样必须带 `DSH_HOME="$PWD/.dsh"`；禁止把本地测试指向 `$HOME/.dsh` 或其他检出目录。
- 本地端口固定 `8070`，与 FPK 网关的 `127.0.0.1:3080` 互不冲突，可同时运行。

### DSH Desktop 测试

- **客户端（固定）**：Desktop 测试**不使用**系统安装的 `/Applications/DeepSeek Harness.app`，改用**上游源码检出 `fork-pj/deepseek-harness` 的开发态 Desktop**。理由有两条：一是需要跟随待测插件与其依赖的最新行为，已安装的发行版壳无法替换；二是开发态启动器天然暴露 CDP 调试端口，取证路径可脚本化。
  - 检出位置由环境变量 **`DSH_DESKTOP_APP_DIR`** 指定（指向该检出根的绝对路径），不写进受版本管理的文件——它属于[编码边界](./sdd-workflow#禁止绝对路径)明令禁止的「指向其他检出的路径」，写死后换机器或换检出即失效。未设置时该检出按与本仓库同级的工作区目录解析（`<工作区根>/fork-pj/deepseek-harness`）。
  - 首次使用需在该检出内安装依赖（`pnpm install`）。`dev:desktop` 会自行构建（根与 `apps/desktop` 两次 `build`）并校验产物存在，因此**不需要**手动预构建；只有确信产物最新时才加 `--skip-build`。缺依赖的检出会直接启动失败，不要据此判定插件缺陷。
  - 启动命令（**必须显式传 `DSH_HOME`**，见下方 profile 约束；端口按需覆盖）：
    ```bash
    DSH_HOME="<repo>/.dsh" DSH_DESKTOP_RENDERER_DEBUG_PORT=9333 \
      pnpm --dir "$DSH_DESKTOP_APP_DIR" run dev:desktop
    ```
    开发态启动器读取 `DSH_HOME` 作为 profile 根（未设置时回落到该检出的构建目录），并把 `DSH_DESKTOP_USER_DATA_DIR`（同样缺省落在构建目录）作为 Electron 用户数据目录；两者都不要指向用户主目录。
- **profile 位置约束（强制）**：Desktop 测试**禁止使用 `~/.dsh/profiles/desktop`**（用户主目录下的个人 profile，含个人凭据与个人配置）；必须使用**项目根目录 `.dsh/profiles/desktop`**，与本地 Web 测试共用同一份 `DSH_HOME=<repo>/.dsh`，使 Desktop 测试与 Web 测试的插件版本、auth 配置备份/恢复（见[账号状态测试顺序与 auth 配置备份](#账号状态测试顺序与-auth-配置备份)）和数据清理作用在同一目录上。
  - **profile 由 Desktop 应用自己创建**：`desktop` 是 Electron 应用保留的 profile 名，dsh CLI 一律拒绝操作它（`dsh plugin --profile desktop …` 报 `profile "desktop" is managed exclusively by the Electron application`），且它**不是**随发行版的 profile 模板（`dsh-app-boot` 的 `PROFILE_TEMPLATES` 只有 `acp`、`web`、`headless`、`sdk`、`sdk-minimal`），因此**不能**用 `dsh --from-default-profile desktop` 创建。正确做法是用项目 `DSH_HOME` 启动一次 Desktop，由应用初始化 `.dsh/profiles/desktop`。
  - 启动 Desktop 前确认其 `DSH_HOME` 指向项目根 `.dsh`（Desktop 按标准解析顺序读取 `$DSH_HOME`，缺省回落 `~/.dsh`）；从用户主目录 profile 启动的测试结果无效。
  - `~/.dsh/profiles/desktop` 属于个人日常使用环境，不得作为测试对象，也不得把测试改动写回该 profile。
- **用 CDP 驱动 Desktop 界面取证**：Desktop 的界面是 `dsh-app://app/` 自定义协议，浏览器无法直接打开。开发态启动器的渲染进程调试端口由 `DSH_DESKTOP_RENDERER_DEBUG_PORT` 指定（缺省 `9222`，本规范统一用 `9333` 以免与本地 Web 调试冲突）。连通性用 `curl http://127.0.0.1:9333/json/version` 确认后，用 CDP 在渲染进程内求值即可断言插件页、详情页与渲染结果（用法与本规范[真实 NAS 测试](#真实-nas-测试)的 CDP 路径一致）。
  - 开发态启动器缺省同时打开 DevTools（`DSH_DESKTOP_OPEN_DEVTOOLS=0` 可关闭），取证时注意区分应用窗口与 DevTools 目标。
- **测试完成后必须把 Desktop 改回全局 profile（强制）**：用项目 `DSH_HOME` 启动的 Desktop 会以项目 profile 作为日常环境，测试结束后把应用交还给用户个人的全局 profile。若测试期间**同时**启动过系统安装的 Desktop（缺省 `DSH_HOME` 即 `~/.dsh`），收尾动作固定为：退出该实例 → 不带 `DSH_HOME` 重新启动 → 确认 profile 已回落。
  - 开发态 Desktop 与本地 Web 测试共用 `<repo>/.dsh`；收尾时**只处理 Desktop 实例**，不影响正在运行的 `pnpm run start -- --web`。
  - 恢复动作与「测试数据清理」（见[测试数据清理](#测试数据清理)）一并在测试执行结果的备注列登记；未登记的视为测试未收尾。
- **验证重点**：Desktop 与 Web 的宿主差异点优先覆盖——外部链接经系统默认浏览器打开（Electron `setWindowOpenHandler` 语义）、OAuth 授权回流、插件详情页/配置区块渲染、设置页呈现；行为以 Desktop 实测为准，不以 Web 结果外推。
- **结论登记**：Desktop 走查结论可与同一需求的 Web 走查合并登记在测试用例文档的「测试执行结果」，按客户端分列；涉及真实用户确认的结论按[验收证据规范](../validation/README.md)登记 `docs/validation/`。结论中必须写明所用 Desktop 的来源（`fork-pj/deepseek-harness` 检出）与其版本，便于复现。
- 用例的「前置条件」与「执行环境」按上述口径填写；执行环境取值使用 `DSH Web`、`DSH Desktop`、`真实 fnOS NAS`、`文档站构建环境`，不使用「本地」等含糊表述。

### 真实 NAS 测试

**测试设备与入口（固定）**：

- 测试在内网 NAS 桌面网页完成：`http://192.168.119.6:5666/`。
- **禁止存储 NAS 账号密码**：任何受版本管理文件、测试文档、脚本和环境变量清单中都不得出现 NAS 凭据；需要登录时**向需求提出人询问**，或使用 `trim-cli` 的 OAuth 交互式登录（不索取、不代填账号密码）。
- 登录后进入 fnOS 桌面进行应用测试；浏览器操作可由 Chrome DevTools（CDP）驱动完成（先例见 `docs/validation/` 既有记录）。

**应用安装**（二选一，均安装到**存储 1**）：

- **trim-cli 安装**（优先，结果可断言）：
  ```bash
  trim-cli --host 192.168.119.6 --port 5666 --profile home --scheme http \
    --allow-insecure-http app install-fpk <fpk 文件> --volume-id <存储1 的 volume-id> --yes
  ```
  写操作必须显式 `--yes`；`--volume-id` 通过 `trim-cli ... storage pools` 查询「存储 1」对应 id；建议先加 `--dry-run` 验证安装信息与 guard。安装/更新会创建并轮询下载与安装任务，等待任务完成后再继续断言。
- **Chrome CDP 在应用中心安装**：通过 CDP 驱动 NAS 桌面网页，在应用中心完成 FPK 上传与安装向导；目标存储空间选择**存储 1**。无法用 trim-cli 断言的向导交互走此路径。

**日志与取证**：应用安装与运行日志在 NAS 的 `/var/log/apps/<应用名称>.log`（如 `/var/log/apps/fn-deepseek-harness.log`）；通过 `trim-cli` 文件命令读取或导出，失败取证时附在测试执行结果或 `docs/validation/` 记录中，日志中的 Token、凭据先脱敏。

**安全红线**：NAS 凭据、auth 文件与测试账号信息**一律不得进入仓库**——不得写入受版本管理的代码、文档、脚本、`.env` 和测试用例；auth 配置备份只允许存放在 `tmp/auth-back/`（见[账号状态测试顺序与 auth 配置备份](#账号状态测试顺序与-auth-配置备份)），NAS 日志引用前先脱敏。

### UI 测试（视觉与样式）

涉及客户端 UI 的用例执行时，除功能行为外必须逐项核对视觉表现；样式实现要求见[插件 UI 规范](./plugin-ui-standards.md)，测试按以下清单核对：

**1. 亮色与暗色主题都要测**：每条 UI 用例在亮色、暗色主题下各执行一遍（执行结果按主题分列或在备注标注「亮/暗均验证」）。重点核对文本、阴影、border 与背景之间的颜色对比：

- 文字在其背景上可清晰阅读，无低对比「看不清」的组合（亮色背景配浅灰字、暗色背景配深灰字都算失败）。
- 阴影在两个主题下都符合层次意图：亮色阴影可见但不突兀，暗色阴影有足够深度区分浮层与底层。
- border 与背景的区分度成立：边框要么可见地分隔区域，要么刻意不可见；禁止「隐约可见但起不到分隔作用」的中间态。
- 主题切换（亮 ↔ 暗）后所有自定义样式跟随，无残留亮色值或残留暗色值的元素。
- 发现对比问题的，优先检查样式是否误用了硬编码颜色而非 [DSH 语义变量](./plugin-ui-standards.md)。

**2. 间距叠加与 BFC**：核对相邻元素的 padding/margin 叠加与块级格式化上下文（BFC）行为：

- 相邻元素的垂直 margin 是否发生折叠（collapse）：设计上需要间距叠加的允许折叠，视觉上出现意外空隙或双倍间距的判定为缺陷。
- 父容器与首/末子元素的 margin 是否穿透（margin 穿透使 padding 失效）：需要隔离时为父容器建立 BFC（如 `display: flow-root`、`overflow` 非 visible、flex/grid 容器），优先用 `flow-root` 而不是副作用大的 `overflow: hidden`。
- 浮层（portal 到 body 的 Modal、Dropdown 等）不受父容器 `overflow`/`transform` 裁剪或定位上下文污染。
- 检查手段：DevTools 盒模型逐层查看 margin/padding 合成结果；对可疑间距用「临时给元素加背景色」的方式确认实际占位来源。

**3. 毛玻璃（backdrop-filter）**：透明背景元素需要毛玻璃效果时遵循以下规则；实现约定以[插件 UI 规范](./plugin-ui-standards.md)为准：

- **毛玻璃尽量加在父元素**：由承载透明背景的容器统一设置 `backdrop-filter`，其子元素直接继承模糊后的视觉，不再叠加效果。
- **子元素禁止重复叠加**：子元素不得同时使用 `backdrop-filter` 与透明背景（两层模糊叠加产生重影和性能损耗）；子元素需要自己的表面时用不透明或半透明纯色变量，不再加模糊。
- 透明背景元素必须有对应的 `backdrop-filter` 或明确的半透明变量组合（如官方 `--dsw-specific-menu` + `--dsw-menu-backdrop-filter` 成对使用），禁止「只有透明背景、无任何模糊」导致的看穿穿帮。
- 一个视觉块只允许一条模糊链路：出现嵌套的两层 `backdrop-filter` 即判定为缺陷，需把模糊上移到父级。
- 核对亮暗两个主题下毛玻璃的可读性：模糊后的文字对比度仍满足第 1 条。

### Midscene 浏览器自动化测试

**按用例类型选择执行方式，不是所有 UI 用例都必须自动化。** 本节新增一条可选执行路径，人工走查与 CDP 取证的地位不变（[执行环境](#测试环境执行方式)的既有约束继续适用）。

Midscene 用自然语言驱动浏览器完成「打开页面 → 交互 → 断言」，模型请求经 [Midscene Bridge](/plugins/dsh-midscene) 插件托管的本地桥接服务走 DSH 已配置的模型。适用与不适用：

| 适用 | 不适用 |
| --- | --- |
| 多步骤 UI 走查（点开若干页面、逐项核对） | 单点断言（某元素是否存在）——CDP 脚本更快 |
| 需要留存可读证据与复跑能力的 E2E 交互断言 | 单元测试、类型检查、构建验证（既有命令不变） |
| 需要视觉判断的验收（布局、主题、图标、空状态） | 真实 NAS 的写操作（安装/卸载/设置变更）——仍走 trim-cli 或应用中心人工流程 |

#### 前置条件（项目测试环境）

1. 桥接插件已装入项目 `.dsh` 的 web profile 且健康检查可用：
   ```sh
   curl -s http://127.0.0.1:8787/v1/health
   ```
2. 运行 Midscene 的工作目录有一份接入配置，**由插件生成、不需要任何模型密钥**（[详见插件说明页](/plugins/dsh-midscene#接入-midscene)）。**先确认桥的实际端口**——默认 8787，被占用时会自动跳号（8788、8789…），写死端口会在跳号后连不上：
   ```sh
   # 1) 发现实际端口（也可从插件设置页的「桥接地址」读）
   PORT=8787
   curl -s "http://127.0.0.1:$PORT/v1/health" || PORT=8788
   # 2) 用实际端口生成 .env
   curl -s "http://127.0.0.1:$PORT/v1/midscene-env" |
       python3 -c "import json,sys; print(json.load(sys.stdin)['content'])" >.env
   ```
   生成的 `MIDSCENE_MODEL_API_KEY` 是占位值（桥不做鉴权、不转发凭据）；模型来自 DSH 已配置的提供方，因此**不要**为 Midscene 准备第三方 API key。健康响应里的 `port` 字段是权威值。
3. 模型必须 `vision: true`（`curl -s "http://127.0.0.1:$PORT/v1/models"`，或让插件自动挑：不传 `?model=` 时它优先选「有图片能力且家族可推断」的模型）——Midscene 靠截图理解页面。若响应带 `familyWarning`，该模型未匹配到 Midscene 已知家族，应按插件说明页的指引换模型或补 `MIDSCENE_MODEL_FAMILY`。

#### 接入方式优先级（Bridge Mode 优先）

三种接入方式按下列优先级选择；**前一种可用时不用后一种**：

| 优先级 | 方式 | 适用与代价 |
| --- | --- | --- |
| 1 | **Bridge Mode**（推荐） | 由用户真实 Chrome 里的 Midscene 扩展反向连接脚本。浏览器**用户可见**、复用真实 cookies 与登录态、无钥匙串弹窗、视口即真实窗口。前提：Chrome 已装 Midscene 扩展（一次性） |
| 2 | 默认 Puppeteer 模式 | 脚本自启浏览器（`connect --url …`）。无需扩展，但窗口对用户不可见 |
| 3 | CDP 模式 | 附加既有调试端口。仅在前两者不可用时使用；有钥匙串与视口两个坑（见下节） |

**Bridge Mode 实测对比**（同一台开发机、同一任务）：

| 维度 | Bridge Mode | CDP 直连 |
| --- | --- | --- |
| 浏览器可见性 | 用户可见 | headless，不可见 |
| cookies / 登录态 | 复用用户真实环境 | 全新 profile |
| macOS 钥匙串授权 | 无弹窗 | 每次新建 profile 都可能弹（Chrome for Testing 为 adhoc 签名） |
| 视口 | 用户真实窗口（实测 1920×906） | headless 默认 756×413，侧边栏收缩为图标态（见下节） |

用法（脚本已入仓，模型配置仍指向插件托管的桥）：

```sh
# 1) 目标页面（带 token 的完整 URL）
# 2) 放好接入配置（四行固定值，端口以 /v1/health 的 port 为准）
curl -s "http://127.0.0.1:$PORT/v1/midscene-env" |
    python3 -c "import json,sys; print(json.load(sys.stdin)['content'])" >.env
# 3) 运行（Chrome 首次会弹授权窗口，选 Allow 或 Always Allow）
pnpm --filter @tnnevol/dsh-midscene run test:bridge "<目标URL>"
```

#### Midscene Test 项目（交互用例的正式载体）

交互类用例用 [Midscene Test](https://midscenejs.com/zh/midscene-test/configuration.html) 承载：YAML 描述步骤、`midscene.config.ts` 声明运行环境。本仓库的装配层封装在共享包 `packages/dsh-e2e-kit`（`@tnnevol/dsh-e2e-kit`），各插件只需写自己的用例与一份极薄的配置。

**位置约定**

| 内容 | 位置 |
| --- | --- |
| 共享装配（Bridge setup、标签页纪律、结果核实、接入配置） | `packages/dsh-e2e-kit/` |
| 某插件的交互用例与项目配置 | `plugins/<插件>/tests/e2e/`（配置 `midscene.config.ts`，用例 `cases/*.yaml`） |
| 运行入口 | 插件 `package.json` 的 `test:e2e`（`midscene-test --config tests/e2e/midscene.config.ts`） |

`files.include` **相对执行目录**（插件根）解析，不是相对配置文件所在目录——写成 `tests/e2e/cases/**/*.yaml`。

**用例与测试文档的对应**（避免两处定义漂移）

- 测试文档（`docs/tests/`）是**权威台账**：登记用例编号、判定标准、执行结果、Bug 与结论；
- YAML 是**执行载体**：`name` 字段以 `TC-0xx` 开头与文档编号对齐（如 `TC-029 开启时激活态、关闭时普通态`），`tags` 标注需求编号与类型（`ui`/`interactive`/`theme`），便于分级执行；
- 两侧都要能独立读懂，不互相复制长段落。

**写用例的四条实测约束**（都踩过，务必遵守）

1. **YAML 会插值**：`${name}` 是**项目变量**（缺失即解析报错），`${{NAME}}` 才是环境变量。因此 `javascript` 步骤里不要写模板字面量（用字符串拼接），跨步骤状态也不要挂 `window.__x`（同样会被扫描）。
2. **用例必须自己建立起始状态**：有头浏览器复用真实页面，前一个用例可能把控件留在任意状态。实测 TC-029 按「默认开启」写，被前序用例切到关闭态后必然失败。每个用例先用步骤把状态归一。
3. **归一动作必须用真实点击**（`aiAct`），不能用 `javascript` 里的 `element.click()`：实测程序化点击**不会**切换 React 受控状态（`aria-pressed` 不变）。
4. **断言分工**：精确状态（开关、文案、类名）交给 `javascript` 读 DOM/属性；视觉观感（形态、图标、对比）交给 `aiAssert`。**否定式判断不要交给视觉模型**——实测它把药丸按钮本身误判成「开关式控件」；「不存在 X」用 `javascript` 表达。

**状态依据从组件源码取，不靠猜**：如 `dsh-failover-search` 的药丸按钮，源码里 `className` 带 `--active` 才是激活态、`aria-pressed` 是状态属性、`aria-label` 含状态文案（`src/client/smart-search-toggle.tsx` 与 `styles.scss`）。用例按这些稳定契约断言，而非背景色等易变表现。

**僵尸页面的自动降级**：桥接复用到的页可能已被浏览器冻结/丢弃（实测实例重启后遗留的页上任何 `evaluateJavaScript` 都会挂到 Midscene 自身的 30s 超时，导致整轮用例 `not run`）。共享包在绑定后**先探活再动页面**，不可用则重建 Agent 换一个新页——因此切页只能靠重建 Agent（`setActiveTabId` 只能绑定一次）。

#### 连接目标页：一律用共享入口

**任何**驱动有头浏览器的脚本（含 `tmp/` 下的一次性探测脚本）都必须用共享包提供的
`connectTarget()` 连接目标页，不要直接调 Midscene 的 `connectNewTabWithUrl()`：

```ts
import { AgentOverChromeBridge } from '@midscene/web/bridge-mode'
import { connectTarget, loadBridgeEnv, applyBridgeEnv } from '@tnnevol/dsh-e2e-kit'

applyBridgeEnv(await loadBridgeEnv())
const agent = new AgentOverChromeBridge()
const { reused, tabId } = await connectTarget(agent, targetUrl, { log: console.log })
```

它按「先查后绑定」的顺序处理三种情形（目标页已打开／当前活动页即目标页／都没有才新开），
并把「新开页」变成需要显式发生的少数情况。

**为什么写成硬要求**：Midscene 的 `connectNewTabWithUrl()` **无条件** `chrome.tabs.create()`，
它不判断目标页是否已打开；而复用的责任在调用方。这里的实测教训是——复用逻辑一度只存在于
Midscene Test 的项目 setup 里，于是 29 个「图省事直接连新页」的探测脚本各开一页又不关闭，
浏览器里堆积了几十个重复标签页。**规矩只写在文档里、而临时脚本用不上，就是治理漏洞**；
把复用做成默认入口才算堵住。

`allowNewTab: false` 可用于「只允许复用」的场景（目标页不存在时直接报错，避免无意中堆积）。

#### 有头浏览器（Bridge Mode）的标签页纪律

用有头浏览器测试时，浏览器的标签页是**用户真实工作环境**的一部分，必须遵守四条纪律（脚本已实现）：

| 纪律 | 做法 | 原因 |
| --- | --- | --- |
| **先查后复用** | 连接前先 `getBrowserTabList()`，目标页已打开就直接绑定它 | 重复开页会在用户浏览器里堆积标签页；同源同路径即视为同一页（DSH Web 的 `?token=` 会随实例重启变化，按完整 URL 比较会导致复用失效） |
| **复用后回到确定起点** | 复用页先把目标 URL 重新走一遍再开始用例 | 复用页可能停在上次测试留下的状态（如停在插件列表页），直接断言「首页可见」会误判为失败 |
| **收尾至少保留一个目标页** | 断开时不要把唯一的目标页关掉 | 保留一个目标页便于用户复核，也是「测试完毕页面可查」的取证前提 |
| **关闭本次多开的重复页** | 只关闭本次运行**新建**的页 | 重复页属于测试副作用，应清理；复用来的页不属于本次副作用，不动 |

**实现依据**（Midscene 扩展侧 `ChromeExtensionProxyPage`，实测确认）：

- `setActiveTabId` 内部为 `if (this.activeTabId) throw …`——**活动页只能绑定一次**；而 `connectCurrentTab()` 会立刻绑定当前活动页。因此必须**在绑定之前**查列表并选定目标页，否则一旦绑定就再也切不过去。
- `destroy(closeTab)` 只关闭 `newlyCreatedTabIds` 里记录的页（`chrome.tabs.remove` 逐个关闭），**复用来的页不受影响**——「关闭重复页、保留原有页」正是它的语义。
- 扩展侧只有 `chrome.tabs.{get,query,update,remove}` 等有限能力，**没有通用的「关闭任意页」入口**；因此关闭重复页只能靠 Midscene 自身的 `destroy` 记录，脚本不应也无法越权关闭用户手动打开的页。

Bridge Mode 的硬性要求：**模型配置在 Node 侧**（终端环境变量），不在浏览器侧——这与本仓库「接入配置放 `.env`」的约定一致。桥接模式会忽略 `viewportWidth`、`userAgent`、`cookie`、`extraHTTPHeaders`、`chromeArgs` 等选项（复用桌面浏览器配置）。

#### 三类被测环境的接入方式

| 被测环境 | 接入方式 | 备注 |
| --- | --- | --- |
| 本地 DSH Web 页面 | **Bridge Mode**（优先）或默认 Puppeteer 模式，`connect --url http://127.0.0.1:8070/?token=…` | 需要带 token 的完整 URL；token 从 `pnpm run start -- --web` 的输出里取 |
| DSH Desktop | CDP 模式附加渲染进程调试端口（[Desktop 测试](#dsh-desktop-测试)的端口约定） | 兼容性以实测为准；失败时回退人工走查 + CDP 取证，并在用例文档如实标注 |
| 真实 fnOS NAS 桌面网页 | 只读走查（打开页面、读状态、截图） | 一律不做写操作；写操作走既有流程 |

#### 执行与证据

- **用例写法**：把「测试步骤」写成自然语言指令（`act --prompt "…"`），「预期结果」写成自然语言断言（`assert --prompt "…"`）；执行方式在执行结果备注栏标注「Midscene」。
- **证据登记**：Midscene 生成的 HTML 报告与截图是执行证据；需要长期留存的按[验收证据规范](../validation/README.md)登记 `docs/validation/`，正文引用报告路径与关键结论，不复制大段报告内容。
- **版本记录**：本节的版本三元组按[客户端与基线版本记录](#客户端与基线版本记录)执行；额外记录 Midscene CLI 版本（`npx -y @midscene/web@1 --version`）与所选「提供方/模型」。
- **额度提示**：Midscene 每步都调视觉模型，按所选提供方计费。用例设计应避免无意义的重复步骤；长任务先在小页面验证流程。
- **测试数据清理**：Midscene 运行产生的 `midscene_run/` 报告目录与截图按[测试数据清理](#测试数据清理)处理；接入配置（`.env`）**不入仓库**——它虽只含占位密钥，仍按「配置文件不进版本管理」的既有红线执行，测试结束用 `git status` 确认无混入。

#### CDP 模式的环境前置（备选方式；macOS 钥匙串授权与视口）

在 macOS 上用 CDP 模式驱动 Chrome 时，**每次新建用户数据目录都可能弹出系统钥匙串授权**（「Google Chrome for Testing 想要使用你储存在钥匙串的 Chromium Safe Storage 中的机密信息」）。根因是 Puppeteer 下载的 Chrome for Testing 是 **adhoc 签名、无 Team ID**，系统无法把它与钥匙串条目的既有授权绑定，于是每次访问都要求重新确认。

实测结论（同一台开发机，Chrome for Testing 150.0.7871.24）：

| 启动参数 | 结果 |
| --- | --- |
| 无 | Cookie 库无法建立（20 秒后仍无 `Cookies` 文件），等待弹窗授权时**存储不可用** |
| `--password-store=basic` | 同样无法建立 Cookie 库（0 字节） |
| `--use-mock-keychain` | Cookie 库正常建立（20 KiB），不触碰真实钥匙串，**无弹窗** |

因此本规范统一要求：**CDP 模式一律加 `--use-mock-keychain`**，并使用**固定的用户数据目录**（如 `~/.cache/dsh-midscene-cdp-profile`，不要每次 `mktemp` 新建——新目录会重新走一遍安全存储初始化）：

```sh
"$CHROME" --remote-debugging-port=9222 \
    --user-data-dir="$HOME/.cache/dsh-midscene-cdp-profile" \
    --use-mock-keychain --no-sandbox --disable-gpu --headless=new "http://127.0.0.1:8070/?token=…"
```

补充说明：

- `--use-mock-keychain` 让 Chrome 使用内存中的模拟钥匙串，**不写入也不读取**系统钥匙串。代价是该 profile 里保存的密码/令牌不跨进程持久；对「打开页面 → 交互 → 断言」的测试用例无影响。
- 无头模式下 Chrome 需 `--no-sandbox` 才能启动（本会话文件沙箱下 `sandbox initialization failed: Operation not permitted`）。这是开发机环境限制，与插件无关。
- 如果仍然弹出授权窗口，选择「始终允许」只对该**二进制与签名**生效；换 Chrome for Testing 版本（如 149 → 150，CDHash 变化）后需要重新授权——这也是统一加 `--use-mock-keychain` 的原因。

#### 视口与定位精度的实测约束

**这些约束只适用于 CDP 与默认 Puppeteer 模式；Bridge Mode 用用户真实窗口，不存在视口收缩问题**（但仍必须独立核实交互结果，见第 2 条）。

本轮实测（FNOS-013，DSH Web + Chrome for Testing 150.0.7871.24）确认两条会影响结论的约束，Midscene 用例设计必须遵守：

1. **视口必须 ≥1440 宽**。headless 默认视口为 756×413，此宽度下 DSH 侧边栏收缩为纯图标模式，文字菜单项（如「插件」）在 DOM 中**不存在**。此时 `act` 会点到图标位置并**自述成功**，但页面并不跳转（假成功）。用 `--window-size=1512,945` 启动，或对 CDP 附着的页面先 `page.setViewport()`。
2. **不要只信 `act` 的自述**。同上的假成功说明：判断「交互是否真的生效」必须独立取证——用 CDP 读 DOM（`document.body.innerText.includes(...)`）或断言页面状态，而不是采信 act 返回的文本。

**定位精度余量偏小（实测数据）**：DSH 侧边栏菜单项高 36px（真实区域 `y∈[120,156]`，中心 `(140,138)`）。同一指令三条路径的落点：

| 路径 | 落点 | 是否命中 |
| --- | --- | --- |
| SDK（`PuppeteerPageAgent`，视口 1512×945） | `(86,130)` | 命中 |
| YAML 运行器（`@midscene/cli`） | `(68,110)`、`(200,110)`、`(201,110)` | 均落空（偏上 10–28px） |
| YAML 运行器 + `--deep-locate` | `(200,110)` | 落空 |

因此在本项目页面上的使用建议：

- **点击小控件（行高 <40px 的菜单项、页签、图标按钮）优先走 CDP 脚本**——页面内 `element.click()` 稳定且精确。
- **Midscene 的强项是断言与多步流程**（截图理解、自然语言判断），实测其 `aiAssert` 与 `act` 的「点击大目标」均正常。
- 点击落空时先核对视口宽度与落点坐标（报告里可读到 `Tap` 的 `center`），再判定是否为功能缺陷。

#### 与人工走查、CDP 取证的分工

| 场景 | 首选方式 |
| --- | --- |
| 改动小、看一眼就够 | 人工走查 |
| 需要断言特定 DOM 状态、抓日志、读网络响应 | CDP 脚本 |
| 多步骤流程、需要可复跑的自然语言用例、需要视觉判断 | Midscene |

三者在同一需求内可并存；用例文档只记录**实际使用的**执行方式及其结论。

### 客户端与基线版本记录

测试开始前必须记录被测环境的版本三元组，写入「测试执行结果」的备注或该需求的测试环境章节；缺版本记录的执行结果不可作为结论依据：

| 环境 | 必须记录 |
| --- | --- |
| DSH Web | DSH 运行时版本（`dsh --version` 或本地 profile 对应版本）、插件构建版本 |
| DSH Desktop | Desktop 客户端版本、其内置 DSH 运行时版本、实际加载的插件版本 |
| 真实 fnOS NAS | fnOS 版本、FPK 应用版本、插件版本（与[验收证据模板](../validation/README.md)字段一致） |

- **版本匹配前置检查**：Desktop 内置的 DSH 运行时版本必须满足插件声明的兼容范围（插件按运行时版本精确锚定，见各需求的功能定义）。在旧 Desktop 上测新插件、或反之，结果无效，须先升级客户端或插件到匹配组合再执行。
- 版本组合与被测需求的目标基线不一致时，结果标记为「阻塞」并注明版本差；不得据此得出功能缺陷结论。

### 测试数据清理

测试会写入会话、凭据、账号、授权目录等用户数据；测试完成后按以下约定处理，避免污染后续测试基线：

| 数据位置 | 清理约定 |
| --- | --- |
| 本地 Web profile（`<repo>/.dsh`） | 测试产生的会话、测试账号凭据在需求验收完成后删除；`.dsh` 已被 git 忽略，清理不影响仓库 |
| DSH Desktop | 测试账号在客户端内退出登录并移除；插件偏好如被改动，恢复默认值；**以缺省 `DSH_HOME` 重启一次，把 Desktop 交还给 `~/.dsh` 的全局 profile**（见 [DSH Desktop 测试](#dsh-desktop-测试)） |
| 真实 fnOS NAS | 测试目录、测试文件、测试工作区在验收记录中列出并在设备上删除；NAS 侧数据不进仓库 |

- 清理动作登记在测试执行结果的备注列（如「已清理测试账号 1 个」）；无法当场清理的（如需要保留复现的 Bug 现场），在 Bug 记录中注明保留原因与预计清理时间。
- 涉及真实账号的测试禁止使用个人生产账号；使用专用测试账号并在需求范围内注明。

### 账号状态测试顺序与 auth 配置备份

Codex Auth 与 CodeBuddy 插件的**已登录账号配置文件可直接用作测试账号**（无需每次走真实登录流程）。涉及登录状态的测试按固定顺序执行，并在状态切换前备份/恢复 auth 配置：

**测试顺序**（登录态 Bug → 非登录态 Bug → 登录流程）：

1. **先测登录状态 Bug**：auth 配置在位，账号已登录，覆盖登录态下的功能与显示问题（用量、模型列表、账号管理等）。
2. **再测非登录状态 Bug**：备份并移除 auth 配置文件，覆盖未登录态的空状态、引导提示、降级行为。
3. **最后测登录流程**：从无 auth 配置的干净状态走真实登录，验证完整链路；完成后按需从备份恢复或保留新凭据。

**auth 配置文件位置**（均在 `DSH_HOME` 下，本地测试即 `<repo>/.dsh`，NAS 测试为对应 profile 目录）：

| 插件 | 配置文件 | 说明 |
| --- | --- | --- |
| Codex Auth（`dsh-codex-auth`） | `.openai-codex-auth.json` | 单文件承载 OAuth 凭据 |
| CodeBuddy（`dsh-codebuddy`） | `codebuddy-auth.json` 及同目录兄弟文件 `.auto-switch.json`、`.auto-checkin.json`、`.auto-travel.json` | 账号凭据与自动行为偏好；涉及对应功能时一并备份 |
| DSH 自身（`dsh-credentials-local`） | `.credentials.yaml` | 模型 provider 的 API key 等凭据。**该文件读不了会让 `credentials` 插件初始化失败，连带 11 个依赖插件挂起并使 DSH Web 直接退出**，恢复时优先级最高 |

**备份与恢复规则**：

- 备份目录：`<repo>/tmp/auth-back/`；`tmp/` 不入库（保持 git 忽略），备份不得写入受版本管理的路径。
- 备份目录名：`<插件名称>-<插件版本>-<备份日期>`，日期格式 `yyyy-MM-dd hh:mm:ss`，示例：`tmp/auth-back/dsh-codex-auth-0.2.0-rc.2.0-2026-09-30 14:30:05/`、`tmp/auth-back/dsh-codebuddy-0.2.0-rc.2.0-2026-09-30 15:02:11/`。
- **移除登录配置前必须先完成备份**：把上表的配置文件原样复制进对应备份目录；恢复登录则从备份目录原样复制回 `DSH_HOME`。
- **恢复后必须显式 `chmod 600`，不能只依赖 `cp -p`**：`cp -p` 会保留源文件的权限位，而 fnOS 的共享文件夹（如 `/vol2/1000/...`）走 ACL，其传统权限位常显示为 `0000`。把这样的文件复制回 `DSH_HOME`（btrfs）后，文件真的变成属主也不可读，恢复动作会直接制造下一次启动失败。恢复命令应写成：
  ```sh
  cp -p "$BACKUP/$file" "$DSH_HOME/$file" && chmod 600 "$DSH_HOME/$file"
  ```
- **恢复后逐一核对权限**：用 `stat -c '%a %n'` 检查每个恢复的凭据文件为 `600`；出现 `0` 即视为恢复失败，必须立刻 `chmod 600` 再继续。仅比对 `sha256` 只能证明内容一致，不能证明可读。
- 每次进入新插件版本测试时新建一份备份目录，不覆盖旧备份；备份中包含真实凭据，禁止提交、截图或粘贴到任何受版本管理与共享的位置。
- 测试全部结束后，确认 `DSH_HOME` 中的 auth 配置与测试前状态一致（恢复备份或保留新登录），并在测试执行结果备注登记状态切换与恢复动作。
- **仓库红线（代码与测试通用）**：测试账号密码、NAS 凭据和 auth 相关文件一律不得上传到仓库——不进受版本管理的代码、文档、脚本、`.env`、测试夹具和测试用例；`.gitignore` 已忽略 `tmp/` 与 `.dsh/`，凭据只允许存在于这两类位置或 `trim-cli` 的 session 存储。提交前用 `git status` 与 `git diff --check` 确认无凭据文件混入。

### 回归用例与基线来源

适配、修复和重构类需求的用例大多是回归验证。这类用例必须在用例行或功能小节标注**基线来源**，指明比对基准：

| 基线类型 | 标注方式 | 示例 |
| --- | --- | --- |
| 已完成需求的验收行为 | 链接到原需求的功能/验收编号 | `基线：[FNOS-007-02](/requirements/FNOS-007-dsh-017-rc2-adaptation#fnos-007-02)` |
| 本需求此前的中间版本 | 注明版本号与对照点 | `基线：0.1.7-rc.2.2 升级前列表行为` |
| 官方上游行为 | 链接上游版本或文档 | `基线：dsh-v0.2.0-rc.2 默认行为` |

- 回归用例的「预期结果」写「与基线一致」时，必须同时给出基线的可观察特征（如「列表展示 3 个目录且顺序一致」），不能只写「与升级前一致」。
- 基线需求已完成时按 [SDD 维护规范](./sdd-workflow)引用其编号，不回改其正文；基线行为被本次需求改变时，在「变更点」中说明新约定。

## 用例模板

用例设计遵循测试用例生成规范：每个功能点至少覆盖正向、逆向、边界、权限、数据一致性五类；步骤可执行、预期可验证。功能表格列固定：

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 取消父目录保留子项 | [AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11) | 已插入父目录与子项引用 | 1.打开插入选择树 2.勾选父目录和子项 3.取消父目录 | 子项引用保留（列表仍显示该子项），父目录引用移除 | P1 | 新增行为，无回归基线 |

优先级：P0（核心阻塞）/ P1（主流程）/ P2（次要分支）/ P3（边角场景）。

「基线来源」列按[回归用例与基线来源](#回归用例与基线来源)填写：回归用例必须链接原需求/版本/上游基准，新增行为写「新增行为，无回归基线」。

### 上下文关联（必填）

功能点、验收条件、计划任务等跨文档引用**必须使用 markdown 链接**指向目标文档锚点，不得写成纯文本编号：

| 引用对象 | 链接格式 | 示例 |
| --- | --- | --- |
| 需求功能 | `/requirements/FNOS-###-主题#fnos-###-##` | `[FNOS-009-11](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11)` |
| 验收条件 | 链到所属功能小节锚点，链接文案写 `AC-##` | `[AC-01](/requirements/FNOS-009-dsh-020-rc2-adaptation#fnos-009-11)` |
| 计划任务/阶段 | `/plans/PLAN-FNOS-###-主题#阶段<锚点>` | `[T05-01](/plans/PLAN-FNOS-009-dsh-020-rc2-adaptation#阶段五授权目录持久化与权限校验t05-01t05-05)` |
| 关联文档（章节标题、功能小节标题） | 标题整体包成链接 | `### [FNOS-009-11 插入 NAS 引用的父子选择解耦](/requirements/...)` |

- 锚点为 VitePress 自动生成的标题 slug（小写、空格与标点转短横线，中英混排保留原文字符）；引用前先在目标文档确认锚点存在。
- 「测试执行结果」「Bug 记录」「测试结论」中再次出现功能点、用例、任务编号时，同样使用链接表达。
- 纯文本编号（如只写 `FNOS-009-11` 或 `T05-01`，无可点击链接）视为不符合本规范。

接口、安全（OWASP）、性能等专项用例需要独立列结构时，在该功能小节内扩展表格列，用例 ID 保持连续编号；未启用的专项在「测试范围」中标注「未启用 + 原因」。

## 执行结果与 Bug 记录

执行后回填，不修改用例定义本身：

### 测试执行结果

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-009-11 | DSH Web | 通过 | 2026-09-30 | 环境版本：DSH 0.2.0-rc.2 / 插件 0.2.0-rc.2.0；已清理测试引用 |

结果取值：通过 / 失败 / 阻塞 / 未执行。失败和阻塞必须关联 Bug 记录或说明原因。备注列记录[客户端与基线版本记录](#客户端与基线版本记录)要求的版本三元组及[测试数据清理](#测试数据清理)动作。

### Bug 记录

| Bug ID | 关联用例 | 标题 | 严重级别 | 状态 | 修复说明 |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | TC-003 | 取消父目录连带取消子项 | P1 | 已修复 | 由 FNOS-009-11 实现，见需求变更记录 |

严重级别沿用 P0–P3；状态取值：新建 / 处理中 / 已修复 / 不修复 / 延后。Bug 修复若引起需求或计划范围变化，按 [SDD 维护规范](./sdd-workflow)登记到当前开发中的需求与计划，不回改已完成文档。

## 测试结论

需求编号整体的最终结果，用户可直接从这里判断「这个需求测下来到底怎么样」：

- **结论取值**：通过 / 部分通过（遗留风险已列出）/ 未通过 / 尚未执行。
- 必须给出：执行用例总数、通过数、失败数、遗留 Bug 数，以及一句话结论。
- 结论状态变化必须追加到文档的「变更记录」。
- 涉及 fnOS 宿主能力的用例，其真实 NAS 执行证据仍按 [验收证据规范](../validation/README.md) 登记 `docs/validation/`；测试用例文档的结论引用该证据，不复制正文。

## 文档检查清单

- [ ] 用例文档已加入 `docs/.vitepress/config.mts` 的 `testsSidebar` 并更新 `docs/tests/index.md`。
- [ ] 元数据含 `id`、`title`、`description`、`requirement`、`plan`、`status`、`lastVerified`、`verifiedAt`。
- [ ] 功能点、验收条件、计划任务引用全部使用 markdown 链接指向目标文档锚点，无纯文本编号（见[上下文关联](#上下文关联必填)）。
- [ ] 执行环境按[测试环境执行方式](#测试环境执行方式)填写：fnOS 插件走真实 NAS，其他插件至少覆盖 DSH Web（`pnpm run start -- --web`，`DSH_HOME` 指向项目 `.dsh`）与 DSH Desktop 两个客户端。
- [ ] 执行结果的备注记录版本三元组；Desktop 内置运行时与插件锚定版本匹配（见[客户端与基线版本记录](#客户端与基线版本记录)）。
- [ ] 回归用例标注基线来源并链接原需求/版本；「与基线一致」的预期附带可观察特征（见[回归用例与基线来源](#回归用例与基线来源)）。
- [ ] 涉及登录状态的测试按「登录态 → 非登录态 → 登录流程」顺序执行；auth 配置备份在 `tmp/auth-back/<插件名称>-<插件版本>-<备份日期>`，移除前已备份、恢复后权限为 `600`（见[账号状态测试顺序与 auth 配置备份](#账号状态测试顺序与-auth-配置备份)）。
- [ ] Desktop 测试使用项目根 `.dsh/profiles/desktop`，未使用 `~/.dsh/profiles/desktop`，启动前已确认 `DSH_HOME` 指向项目根（见[DSH Desktop 测试](#dsh-desktop-测试)）。
- [ ] Desktop 测试完成后已以缺省 `DSH_HOME` 重启一次，Desktop 已交还给 `~/.dsh` 的全局 profile，并在执行结果备注登记恢复动作（见[DSH Desktop 测试](#dsh-desktop-测试)）。
- [ ] NAS 测试在内网 `http://192.168.119.6:5666/` 桌面完成，未存储 NAS 凭据；安装到存储 1，日志从 `/var/log/apps/<应用名称>.log` 取证（见[真实 NAS 测试](#真实-nas-测试)）。
- [ ] UI 用例在亮色与暗色主题下各执行一遍，已核对文本/阴影/border/背景对比、间距叠加与 BFC、毛玻璃层级（模糊在父元素、子元素不重复叠加）（见[UI 测试](#ui-测试视觉与样式)）。
- [ ] 测试账号密码、NAS 凭据与 auth 文件未进入仓库（代码、文档、脚本、测试夹具均不含凭据；备份仅在 git 忽略的 `tmp/auth-back/`）。
- [ ] 测试数据清理动作已登记，无个人生产账号（见[测试数据清理](#测试数据清理)）。
- [ ] 执行结果、Bug、结论仅在执行后回填，用例定义未被改写。
- [ ] 用 Midscene 执行的用例：执行结果备注标注「Midscene」与 Midscene CLI 版本；接入配置（`.env`）未进仓库（`git status` 核对）；`midscene_run/` 产物已按测试数据清理处理（见 [Midscene 浏览器自动化测试](#midscene-浏览器自动化测试)）。
- [ ] `pnpm run check -- --sdd` 与文档构建通过。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-08 | 明确 fnOS 插件以真实 NAS 为唯一验收环境 | 增加说明：`@tnnevol/dsh-fnos` 的功能依赖 fnOS 宿主桥接，真实 NAS 走查通过即通过，不需要 Web/Desktop 复验；并给出判断依据（实现是否落在 `plugins/dsh-fnos-plugin/` 且依赖桥接），避免把 `/fn` 引用选择树这类界面控件误判为需要双客户端覆盖。 |
| 2026-10-09 | 凭据恢复补充 `chmod 600` 与权限核对要求 | 真机暴露：用 `cp -p` 从共享文件夹恢复 `.credentials.yaml` 时带回了 `0000` 权限，导致 `credentials` 插件 `EACCES` 失败、11 个依赖插件挂起、DSH Web 以 code 1 退出。配置表补上 DSH 自身的 `.credentials.yaml`；恢复规则要求恢复后显式 `chmod 600` 并用 `stat` 逐一核对（仅比对哈希不能证明可读）。 |
| 2026-09-30 | 新增测试环境执行方式 | 明确除 fnOS 插件外的其他插件统一在项目 DSH CLI 启动的 DSH Web 中测试（`pnpm run start -- --web`，`DSH_HOME` 固定指向仓库 `.dsh`），fnOS 插件仍走真实 NAS。 |
| 2026-09-30 | 补充 Desktop 测试要求 | 非 fnOS 插件至少兼容 DSH Web 与 DSH Desktop 两个客户端并均纳入用例；新增 Desktop 测试执行方式（客户端获取、宿主差异验证重点、结论登记）。 |
| 2026-09-30 | 新增版本记录、数据清理与基线来源要求 | 执行前记录环境版本三元组并校验 Desktop 运行时与插件锚定版本匹配；测试数据按位置约定清理并登记；回归用例标注基线来源，「与基线一致」须附可观察特征。用例模板增加基线来源列。 |
| 2026-09-30 | 新增账号状态测试顺序与 auth 配置备份 | Codex/CodeBuddy 登录态测试按「登录态 Bug → 非登录态 Bug → 登录流程」顺序执行；状态切换前备份 auth 配置到 `tmp/auth-back/<插件名称>-<插件版本>-<备份日期>`，恢复登录从备份还原并保持 600 权限。 |
| 2026-09-30 | 约束 Desktop 测试 profile 位置 | Desktop 测试禁止使用 `~/.dsh/profiles/desktop`，必须使用项目根 `.dsh/profiles/desktop`，与 Web 测试共用 `DSH_HOME=<repo>/.dsh`；登记 profile 创建与插件链接命令。 |
| 2026-09-30 | 新增真实 NAS 测试规范 | 固定测试入口 `http://192.168.119.6:5666/`；禁止存储 NAS 凭据，登录向需求提出人询问或走 trim-cli OAuth；安装走 trim-cli（`app install-fpk --volume-id`）或 Chrome CDP 应用中心，目标存储为存储 1；日志在 `/var/log/apps/<应用名称>.log`。测试账号密码与 auth 文件禁止上传仓库（代码与测试通用红线）。 |
| 2026-09-30 | 新增 UI 测试规范 | UI 用例亮暗主题各执行一遍并核对文本/阴影/border/背景对比；检查 padding/margin 叠加与 BFC（margin 折叠、穿透、浮层裁剪）；毛玻璃加在父元素，子元素禁止重复叠加 backdrop-filter 与透明背景；CSS 变量优先使用 DSH 官方变量。 |
| 2026-10-06 | 修正 Desktop profile 创建方式并新增测试后恢复全局 profile | `desktop` 为 Electron 应用保留名且非内置模板，原 `dsh --from-default-profile desktop` 命令无法执行；改为用项目 `DSH_HOME` 启动 Desktop 由应用创建 profile，并补充 CDP（`--remote-debugging-port`）驱动 Desktop 界面取证的方法。新增强制收尾：测试完成后以缺省 `DSH_HOME` 重启一次，把 Desktop 交还 `~/.dsh` 全局 profile，并在执行结果备注登记。 |
| 2026-10-12 | 新增「Midscene 浏览器自动化测试」章节 | 新增可选执行路径：Midscene 以自然语言驱动浏览器完成「打开页面 → 交互 → 断言」，模型请求经 [Midscene Bridge](/plugins/dsh-midscene) 走 DSH 已配置模型。章节含适用边界（按用例类型选择，不是强制自动化）、项目测试环境前置条件（桥健康检查 + `.env` 接入配置 + `vision: true` 模型）、三类被测环境接入（本地 Web 直连 / Desktop CDP 附加以实测为准 / NAS 只读走查）、证据登记与版本记录要求、接入配置不入仓库红线、与人工走查/CDP 取证的工分表。顺带修复本文档变更记录表的分隔行损坏（2026-10-08 行误占分隔行位置）。依据：FNOS-013-07。 |

## 回填时机

- 计划文档中对应任务完成后（进入目标环境验收前），在同一变更中创建或更新对应 `FNOS-###` 测试用例文档，把该任务的验证内容落成用例。
- 用例先于执行登记：先写「测试用例」章节，执行后只回填「测试执行结果」「Bug 记录」「测试结论」三个章节。
- 测试用例文档的状态随执行推进更新；需求文档标记「已完成」前，对应测试用例文档的「测试结论」必须已给出最终结果。

## 相关页面

- [SDD 维护规范](./sdd-workflow)
- [需求文档规范](./requirements-spec)
- [计划文档规范](./plans-spec)
- [Midscene Bridge 插件](/plugins/dsh-midscene)——Midscene 浏览器自动化的桥接服务与接入配置
- [验收证据规范](../validation/README.md)
| 2026-10-12 | Midscene 章节改为「桥接服务零配置」 | 原章节要求用户手写四个 `MIDSCENE_MODEL_*` 变量并自行确定家族值，与插件定位（让 Midscene 用 DSH 已有的模型、用户不需要任何第三方密钥）冲突。改为：接入配置由 `/v1/midscene-env` 生成（一条命令），模型自动挑选（优先有图片能力且家族可推断者），并说明 `familyWarning` 的含义与处理。 |
| 2026-10-12 | Midscene 章节补 CDP 模式 macOS 钥匙串前置 | 实测 Puppeteer 的 Chrome for Testing 为 adhoc 签名（无 Team ID），每次新建用户数据目录都可能弹系统钥匙串授权；无参数与 `--password-store=basic` 下 Cookie 库无法建立，`--use-mock-keychain` 下正常建立且不触碰真实钥匙串。统一要求 CDP 模式加该参数并使用固定用户数据目录。依据：本机实测（Chrome for Testing 150.0.7871.24）。 |
| 2026-10-12 | Midscene 章节补视口与定位精度实测约束 | 本轮 FNOS-013 实测确认：headless 默认视口 756×413 下 DSH 侧边栏为图标态、文字菜单项不存在，`act` 会「点到位置但页面不跳转」并自述成功（假成功），因此视口须 ≥1440 宽且交互结果必须独立取证；同一 36px 高控件上 SDK 落点 (86,130) 命中、YAML 运行器 (68,110)/(200,110) 落空（含 `--deep-locate`），故小控件点击优先 CDP、Midscene 用于断言与多步流程。依据：TC-027/028/042/043 与 BUG-03。 |
| 2026-10-12 | Midscene 章节改为「端口按实际值」 | 桥接端口不再固定：默认 8787，被占用时自动向上尝试（最多 20 个）并把实际端口写回配置。章节的前置条件由写死 8787 改为先发现实际端口（健康响应的 `port` 字段为权威值）再用它生成 `.env`；跳号后 `.env` 需重新拉取。依据：FNOS-013-01 行为约束修订。 |
| 2026-10-12 | Midscene 章节新增 Bridge Mode 并升为首选接入方式 | 按 Midscene 官方《Chrome 桥接模式》验证：脚本作 server（默认 127.0.0.1:3766），用户真实 Chrome 里的 Midscene 扩展反向连接，因此浏览器用户可见、复用真实 cookies 与登录态、无 macOS 钥匙串弹窗、视口即真实窗口（实测 1920×906）。实测同一任务在 Bridge Mode 下完整通过（首页断言 → 点击「插件」→ 独立核实进入插件列表 → 列表断言），而 CDP 直连需应对 756×413 窄视口与钥匙串授权。据此把接入方式改为三级优先级（Bridge Mode > 默认 Puppeteer > CDP），CDP 章节标注为备选。验证脚本入仓：`plugins/dsh-midscene-plugin/scripts/bridge-smoke.ts`（`pnpm --filter @tnnevol/dsh-midscene run test:bridge`）。 |
| 2026-10-12 | Midscene 章节新增「有头浏览器的标签页纪律」 | 针对有头（Bridge Mode）测试新增四条纪律：先查后复用（同源同路径视为同一页，避免 DSH Web 的 `?token=` 变化导致复用失效）、复用后回到确定起点（复用页可能停在上次测试状态）、收尾至少保留一个目标页、只关闭本次新建的重复页。实测依据：`setActiveTabId` 只能绑定一次（因此必须「先查后绑定」）、`destroy(closeTab)` 仅关闭 `newlyCreatedTabIds`。验证：连续三轮测试后浏览器 8070 目标页恒为 1 张、总页数无堆积。 |
| 2026-10-12 | Midscene 章节新增「Midscene Test 项目」小节 | 交互用例的正式载体落定为 Midscene Test：共享装配放 `packages/dsh-e2e-kit`，各插件在 `tests/e2e/` 放配置与用例、以 `test:e2e` 为入口。明确用例与测试文档的对应关系（文档是权威台账、YAML 的 `name` 以 `TC-0xx` 对齐）。登记四条实测约束：YAML 的 `${}` 插值是项目变量（javascript 步骤不能用模板字面量）、用例必须自建起始状态、归一状态必须用真实点击（程序化 click 不切换 React 受控状态）、断言分工（精确判定用 javascript、否定式判断不交给视觉模型）。状态依据从组件源码取。新增僵尸页自动降级说明。验证：FNOS-012 的 TC-028/029/030 经 `pnpm --filter @tnnevol/dsh-failover-search run test:e2e` 全部通过。 |
| 2026-10-13 | Midscene 章节新增「连接目标页：一律用共享入口」 | 明确任何驱动有头浏览器的脚本（含 `tmp/` 下的一次性探测脚本）都必须用共享包的 `connectTarget()`，不得直接调 Midscene 的 `connectNewTabWithUrl()`（后者无条件新开页、不判断复用）。背景：复用逻辑一度只存在于 Midscene Test 的 setup 里，导致 29 个探测脚本各开一页又不关闭、浏览器堆积数十个重复标签页——规矩只写在文档而临时脚本用不上即治理漏洞，故把复用做成默认入口。 |
