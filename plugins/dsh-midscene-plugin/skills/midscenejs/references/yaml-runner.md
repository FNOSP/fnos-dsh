# 旧版 YAML 运行器（`@midscene/cli`）

> ⚠️ **这是旧链路**。"旧版 YAML" 特指由 `@midscene/cli` 提供的 YAML 自动化协议：工作流顶层用 `tasks`，每个 task 用 `flow`，平台和 Agent 等运行配置通常写在 YAML 中，通过 `midscene` 命令或含 `files`、`setup`、`concurrent` 等字段的 YAML 批配置运行。
>
> 该链路只做兼容维护和必要修复，**不再新增能力**；新项目和新增用例推荐 [Midscene Test](midscene-test/)。两条链路**不能混用**：`midscene-test` 不会自动识别旧文件，也不接受旧批配置和旧 CLI 参数。

## 安装 CLI

```bash
npm i -g @midscene/cli          # 全局安装（推荐新手）
npm i @midscene/cli --save-dev  # 项目内安装
```

## 配置环境变量

在运行 `midscene` 命令时所在的目录创建 `.env`，`@midscene/cli` 自动读取，**每行不需要 `export`**：

```bash
MIDSCENE_MODEL_BASE_URL="https://替换为你的模型服务地址/v1"
MIDSCENE_MODEL_API_KEY="替换为你的 API Key"
MIDSCENE_MODEL_NAME="替换为你的模型名称"
MIDSCENE_MODEL_FAMILY="替换为你的模型对应的 family"
```

> Shell 中已有的同名变量**默认优先**于 `.env`；需要覆盖用 `--dotenv-override`。（`model verify` 是反向例外。）

## 第一个脚本

Web：

```yaml
page:
  url: https://www.bing.com

tasks:
  - name: 搜索天气
    flow:
      - ai: 搜索 "今日天气"
      - sleep: 3000
      - aiAssert: 结果显示天气信息
```

Android（`deviceId` 用 `adb devices` 获取）：

```yaml
android:
  deviceId: s4ey59

tasks:
  - name: 地图导航
    flow:
      - ai: 打开地图应用
      - ai: 在搜索栏输入 "杭州西湖"，然后点击搜索按钮
      - ai: 点击第一个搜索结果，进入详情页
      - ai: 点击 "路线" 按钮，进入路线规划页面
      - ai: 点击 "开始" 按钮开始导航
```

iOS：

```yaml
ios:
  wdaPort: 8100

tasks:
  - name: 修改系统设置
    flow:
      - ai: 打开设置应用
      - ai: 点击 "显示与亮度"
      - ai: 开启 "深色模式"
      - aiAssert: 深色模式已开启
```

运行：

```bash
midscene ./bing-search.yaml           # 全局安装
npx midscene ./bing-search.yaml       # 项目内安装
```

命令行输出执行进度，结束后生成可视化报告。

## 在 YAML 中使用环境变量

用 `$KEY` 引用当前环境变量来填入动态值，避免把地址、账号等写死在脚本里。

## 高级用法

### 批量与并发

```bash
# 按顺序执行指定脚本
midscene --files ./login.yaml ./buy/*.yaml ./checkout.yaml

# 4 并发执行互不依赖的搜索脚本，出错继续
midscene --files './scripts/search-*.yaml' --concurrent 4 --continue-on-error
```

支持 [glob](https://www.npmjs.com/package/glob) 通配符；匹配到多个文件时按**文件路径字典序**排序加入执行列表。

### 分析运行结果

用 `--summary <filename>` 指定生成的 JSON 总结报告路径。

### Headed 模式

```bash
midscene --headed                # 带界面运行
midscene --headed --keep-window  # 运行完保留窗口（自动开启 headed）
```

### CDP 连接与桥接模式

- `--cdp <ws-endpoint>`：通过 CDP 连接已有浏览器。
- `--bridge`：桥接用户自己的 Chrome（复用其 Cookie、插件、页面状态）。

> ⚠️ 桥接模式和非 Web target **必须省略** `--share-browser-context` / `--reuse-page` 这类共享选项。

## 命令行参数

| 参数 | 说明 |
| --- | --- |
| `--files <f1> <f2> ...` | 指定脚本文件列表，默认顺序执行（`--concurrent` 为 1） |
| `--setup <file>` | 在主 `--files` 之前执行的前置脚本，适用于所有 target。**所有 setup attempt 失败会中止整个批次**，主脚本标记为未执行 |
| `--concurrent <n>` | 并发数，默认 `1` |
| `--continue-on-error` | 某脚本失败后继续执行后续脚本，默认关闭 |
| `--retry <n>` | 失败脚本的额外尝试次数，默认 `0`。可缓解网络波动或大模型输出不稳定 |
| `--share-browser-context` | 多个 Puppeteer Web 脚本间共享同一 BrowserContext（Cookies、同源 `localStorage`），每 YAML 仍用独立 Page。默认关闭 |
| `--reuse-page` | 多个 Puppeteer Web 脚本复用同一 Page，保留 `sessionStorage`、`window.name` 等页面级状态。**必须**同时设 `--share-browser-context` 和 `--concurrent 1` |
| `--summary <filename>` | JSON 总结报告路径 |
| `--headed` / `--keep-window` | 带界面运行 / 运行完保留窗口 |
| `--config <filename>` | 指定配置文件，文件中的参数作为命令行默认值 |
| `--web.userAgent <ua>` | 覆盖所有脚本的 `web.userAgent` |
| `--web.viewportWidth` / `--web.viewportHeight` | 覆盖浏览器视口尺寸 |
| `--android.deviceId` / `--harmony.deviceId` | 覆盖设备 ID |
| `--ios.wdaPort` / `--ios.wdaHost` | 覆盖 WebDriverAgent 端口/主机 |
| `--computer.displayId` | 覆盖显示器 ID |
| `--dotenv-debug` | 开启 dotenv 调试日志，默认关闭 |
| `--dotenv-override` | 允许 dotenv 覆盖同名全局环境变量，默认关闭 |

### 共享上下文的限制

- `--share-browser-context`：即使 `--concurrent 1`，`sessionStorage`、DOM、URL、`window.name` 等**页面级状态也不会共享**。同一批次中 setup 和主脚本必须**全部**用 Puppeteer Web target；不支持桥接模式和非 Web target。浏览器级选项（`cdpEndpoint`、`chromeArgs`、`acceptInsecureCerts`、`downloadPath`）必须放在批次配置的**全局 Web target** 中。
- setup retry 使用**全新** BrowserContext 和 Page；主脚本 retry **保留**成功的 setup 上下文。其他 target 每次 retry 创建新的 player 和 Agent，但**不重置**底层浏览器、设备、桌面或外部 Interface 的状态。

## 迁移到 Midscene Test

| | 旧 `midscene` 链路 | 新 `midscene-test` 链路 |
| --- | --- | --- |
| 用例文件 | `tasks` + `flow` | `cases` + `steps` + 生命周期钩子 |
| 批配置 | YAML（含 `files`/`setup`/`concurrent`） | `midscene.config.ts`（`defineTestProject`） |
| 扩展方式 | YAML 内置指令 | TypeScript 自定义 Node |
| 命令 | `midscene` | `midscene-test` |

两条链路共用执行内核和新的报告页面。迁移期两类文件可放同一仓库的不同目录，但**同一次命令只能选一种格式**。

**升级路径**：保留旧用例、批配置、目录布局和 `midscene` 命令不变，即可获得共享内核和新报告而不改输入契约；完全转换为 Test Document、Case、Step 并替换批配置后，再切换到 `midscene-test`。

字段映射详见官方「迁移到 Midscene Test」文档；Midscene Test 侧说明见 [midscene-test/use.md](midscene-test/use.md)。
