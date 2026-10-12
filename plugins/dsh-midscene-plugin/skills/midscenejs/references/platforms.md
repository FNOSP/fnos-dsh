# 平台接入：Web / Android / iOS / HarmonyOS / 桌面

各平台是**独立包**，Agent 构造函数互不通用，不要跨平台混用。模型配置见 [model-config.md](model-config.md)，Agent API 语义见 [integration.md](integration.md)。

| 平台 | 包 | Playground | Agent 构造 |
| --- | --- | --- | --- |
| Web | `@midscene/web` | Chrome 扩展 | `new PlaywrightAgent(page)` / `new PuppeteerAgent(page)` / `new PlaywrightBrowserAgent(...)` |
| Android | `@midscene/android` | `npx --yes @midscene/android-playground` | `new AndroidAgent(device)` |
| iOS | `@midscene/ios` | `npx --yes @midscene/ios-playground` | `new IOSAgent(page)` / `await agentFromWebDriverAgent({...})` |
| HarmonyOS | `@midscene/harmony` | `npx --yes @midscene/harmony-playground` | `new HarmonyAgent(device)` |
| 桌面 | `@midscene/computer` | `npx --yes @midscene/computer-playground` | `await agentForComputer()` / `agentForRDPComputer()` |

> 各平台 Playground 与 SDK **共享同一实现**：Playground 上验证通过的流程，脚本运行时行为一致。先用 Playground 验证连接是最快路径。

## Web

`@midscene/web` 基于 Puppeteer，默认无头模式。Playwright 集成与 Puppeteer 集成详见 [integration.md](integration.md)。

**Chrome 扩展（Playground）**：从 Chrome Web Store 安装 Midscene 扩展 → 打开侧边栏设置 → 粘贴模型配置。无法访问商店时可从 [GitHub Releases](https://github.com/web-infra-dev/midscene/releases) 下载手动安装（无自动更新）。

## Android

通过 **adb** 连接设备。

### 准备

1. 装 adb 并设 `ANDROID_HOME`（Android Studio 或命令行工具均可）：

   ```bash
   adb --version
   export ANDROID_HOME=/path/to/android/sdk
   ```

2. 设备启用 USB 调试并信任电脑，验证：

   ```bash
   adb devices -l
   ```

3. Playground 验证连接：`npx --yes @midscene/android-playground`

### SDK

```bash
npm install @midscene/android dotenv --save-dev
```

```typescript
import 'dotenv/config';
import {
  AndroidAgent,
  AndroidDevice,
  getConnectedDevices,
} from '@midscene/android';

const devices = await getConnectedDevices();
const device = new AndroidDevice(devices[0].udid);

const agent = new AndroidAgent(device, {
  aiContexts: {
    aiAct: 'If any location, permission, user agreement, etc. popup, click agree. If login page pops up, close it.',
  },
});
await device.connect();

await agent.aiAct('open browser and navigate to ebay.com');
await agent.aiAct('type "Headphones" in search box, hit Enter');
await agent.aiWaitFor('There is at least one headphone product');

const items = await agent.aiQuery(
  '{itemTitle: string, price: Number}[], find item in list and corresponding price',
);
await agent.aiAssert('There is a category filter on the left');
```

```bash
npx tsx demo.ts
```

运行结束控制台会输出 `Midscene - report file updated: /path/to/report/some_id.html`，浏览器打开即可回放每次交互。

自定义动作可用 `defineAction` + `getMidsceneLocationSchema`（来自 `@midscene/core/device`）扩展，并配合 `AndroidDevice`、`getConnectedDevices`。

## iOS

通过 **WebDriverAgent** 连接。

### 准备

- 装 Node.js，配置并启动 WebDriverAgent。
- 用 `WDA_HOST`、`WDA_PORT` 指定连接。
- **真机需要端口转发，模拟器不需要**。

Playground：`npx --yes @midscene/ios-playground`

### SDK

```bash
npm install @midscene/ios dotenv --save-dev
```

```typescript
import 'dotenv/config';
import {
  IOSAgent,
  IOSDevice,
  agentFromWebDriverAgent,
} from '@midscene/ios';

// 方式一：直接创建设备和 Agent
const page = new IOSDevice({ wdaPort: 8100, wdaHost: 'localhost' });
const agent = new IOSAgent(page, {
  aiContexts: {
    aiAct: 'If any location, permission, user agreement, etc. popup appears, click agree. If login page appears, close it.',
  },
});
await page.connect();

// 方式二：便捷函数（推荐）
// const agent = await agentFromWebDriverAgent({
//   wdaPort: 8100, wdaHost: 'localhost', aiContexts: { ... },
// });

await page.launch('https://ebay.com');
```

### 隐藏键盘

`autoDismissKeyboard` **默认 `true`**：文本输入后 Midscene 会尽力定位标准 iOS 键盘辅助工具栏、触发隐藏控件并等待 WDA 确认键盘消失。部分键盘（如 iPhone 数字键盘）无隐藏控件——此时**不会**把输入判为失败，只记录警告日志。

自动隐藏后紧接着执行 `Enter`/`Return`/`Tab` 时，Midscene 会在发按键前恢复一次原输入框焦点；其他指针、触控、系统、自定义或文本输入动作会使该待恢复目标失效。

> ⚠️ App **自定义输入工具栏**可能包含 Save/Submit 等业务操作。对不符合标准「左侧导航、右侧隐藏」结构的工具栏，Midscene 会**主动拒绝点击**。用自定义工具栏时应关闭自动隐藏，并向 `hideKeyboard()` 传入该控件稳定的 accessibility name。

```typescript
const device = new IOSDevice({ autoDismissKeyboard: false });
await device.hideKeyboard(['Close Keyboard']);
```

自定义动作用 `defineAction()` 定义，通过 `agentFromWebDriverAgent()` 的 `customActions` 传入，Midscene 会追加到规划器供 Agent 调用。

## HarmonyOS

通过 **HDC**（HarmonyOS Device Connector）连接 HarmonyOS NEXT 设备。

### 准备

```bash
hdc version
hdc list targets
```

`hdc` 不在系统 PATH 时设 `HDC_HOME` 指向其目录：

```bash
export HDC_HOME=/path/to/hdc/directory
```

启用开发者模式并验证设备。Playground：`npx --yes @midscene/harmony-playground`

### SDK

```bash
npm install @midscene/harmony dotenv --save-dev
```

```typescript
import 'dotenv/config';
import {
  HarmonyAgent,
  HarmonyDevice,
  getConnectedDevices,
} from '@midscene/harmony';

const devices = await getConnectedDevices();
const agent = new HarmonyAgent(devices[0]);
```

也可用 `defineAction` + `getMidsceneLocationSchema` 扩展自定义动作。

常见问题：输入后键盘未隐藏或页面发生返回——见 [faq.md](faq.md)。

## 桌面端

用原生键鼠控制 macOS / Windows / Linux 桌面应用。

### 前置依赖

**macOS**：需**辅助功能权限**才能控制键鼠。首次运行脚本时系统会提示授权；前往 **系统设置 → 隐私与安全性 → 辅助功能**，为运行脚本的程序（Terminal、iTerm2、VS Code、WebStorm 等 IDE）启用。

**Windows**：普通程序无需额外配置，但存在 **UIPI 权限级别隔离**陷阱——

> ⚠️ 未提权进程**无法**向以管理员身份运行的窗口发送鼠标/键盘输入，输入会被**静默丢弃**：光标移动到正确位置，但点击和按键不生效。
>
> 解法：优先让目标程序**不要**以管理员权限运行；若必须提权，就让**启动 Midscene 的终端/Node.js 也以管理员身份运行**，让两个进程处于相同权限级别。

**无头 Linux（CI）**：装 Xvfb 及依赖后启用 headless 模式：

```bash
# 安装依赖
sudo apt-get install -y xvfb
```

Xvfb 创建虚拟显示器，使键鼠和截图在无物理显示器时正常工作。

Playground：`npx --yes @midscene/computer-playground`

### SDK

```bash
npm install @midscene/computer
```

```typescript
import { agentForComputer } from '@midscene/computer';

const agent = await agentForComputer({
  aiContexts: { aiAct: '你正在控制一台桌面计算机。' },
});

const screenInfo = await agent.aiQuery(
  '{width: number, height: number}, 获取屏幕分辨率',
);

await agent.aiAct('将鼠标移动到屏幕中心');
await agent.aiAssert('屏幕有可见内容');
```

```bash
npx tsx example.ts
```

### 远程 Windows 桌面（RDP）

可用专用工厂 `agentForRDPComputer()` 直接经 **RDP 协议**控制远程 Windows 桌面（有前提条件要求）。

## 应用知识补充

各平台 Agent 的 `aiContexts`（尤其 `aiAct`）适合放入**应用特有的操作规则**——如"出现权限弹窗就点同意"、"出现登录页就关闭"。这是提升移动端/桌面端自动化稳定性的关键手段，详见官方「为 GUI Agent 补充应用知识」文档。
