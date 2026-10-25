---
title: 从电脑上传 FPK 到 NAS 并安装
description: 把构建好的 .fpk 通过 fnOS 应用中心的「手动安装 → 从电脑上传」装到真实 NAS 上，并完成验证与排障的完整实战册。面向第一次做这件事的 agent 或人。
---

# 从电脑上传 FPK 到 NAS 并安装

本册是**操作手册**，不是需求文档。它回答一个具体问题：手里有一个 `.fpk`，怎么把它装到真实 fnOS NAS 上、怎么确认装对了、出错了怎么定位。

与相关文档的分工：

| 文档 | 负责什么 |
| --- | --- |
| 本册 | **上传 → 安装 → 验证 → 排障**的操作步骤与踩坑记录 |
| [应用上架规范](../charter/app-listing-spec.md) | 上架**申请**（飞书表单）的字段口径与官方规则自查 |
| [发布流程](../build/release.md) | 发版（打 Tag → CI 出 Release → 取得 FPK） |
| [生命周期脚本](../development/lifecycle.md) | `install_callback` / `upgrade_callback` 各自做什么 |

---

## 0. 先看这一屏：最短路径

```bash
# 1. 取得 FPK（二选一）
#    a) CI 产物（推荐，与线上同一份）
gh release download v<版本号> --pattern "*.fpk" --dir tmp/fpk-upload
#    b) 本地构建
pnpm run build -- --fpk --app fn-deepseek-harness

# 2. 确认版本与 NAS 上已装的**不同**（相同会被直接拒绝）
# 3. 打开 NAS → 应用中心 → 手动安装 → 从电脑上传 → 选文件 → 同意 → 向导 → 下一步 → 安装
# 4. 装完按第 5 节验证
```

其余章节是这条路径上每一个「为什么」。

---

## 1. 前置条件

| 条件 | 说明 | 不满足的后果 |
| --- | --- | --- |
| **版本必须与 NAS 上已装的不同** | fnOS 按版本号判断走「安装」还是「升级」。相同版本会被拒 | 报错「已安装相同或更高版本」，流程走不下去 |
| NAS 登录态有效 | fnOS 网页端的会话 cookie | 页面停在登录页，后续步骤全部落空 |
| 浏览器能访问 NAS | 默认 `http://<NAS-IP>:5666/` | 找不到应用中心 |
| FPK 完整 | 见第 2 节 | 安装回调缺文件、升级失败 |
| 自动化时：Midscene 桥与模型就绪 | 见第 4 节 | 模型调用失败，界面步骤无法执行 |

### 版本号必须是「可比较」的

fnOS 的比较逻辑：**三段式** `x.y.z`，`x.y.z-m` 里的 `m` **只有数字**才有版本对比逻辑，非数字后缀一律「视为同一版本」。

本项目的版本是纯净三段式（如 `6.0.0`，见[版本管理](/build/versioning)），fnOS 可正常按三段比较判定升级：`6.0.0 → 6.0.1` 是**更高版本**，能触发升级路径。

历史注记：`6.0.0` 之前的版本号带非数字小尾巴（如 `5.9.0-0.2.1-rc.2.12`），对 fnOS 等价于 `5.9.0`——同基线内递增小尾巴不触发升级。该形态已被 FNOS-028 取代；若设备上还装着小尾巴版本，升级到 `6.0.0` 属于正常的大版本升级。

实践做法：**每次装机验证前先 `pnpm run version` 升版本**，这是最省事的避坑方式。

---

## 2. FPK 从哪来、里面有什么

### 两种来源

| 来源 | 命令 | 用途 |
| --- | --- | --- |
| CI Release 附件 | `gh release download v<版本号> --pattern "*.fpk"` | **装机验证首选** —— 与线上分发的是同一份 |
| 本地构建 | `pnpm run build -- --fpk --app fn-deepseek-harness` | 迭代快；产物落在 `apps/fn-deepseek-harness/*.fpk` |

CI 产物会被重命名为 `fn-deepseek-harness-<Tag>-dsh-<DSH 基线>.fpk`，注意 `dsh-` 段是 **DSH 运行时基线**、不是应用版本；应用版本以 Tag 为准。

### 「瘦包」是设计，不是构建坏了

CI 固定带 `--skip-bundle-dsh-plugins`，**FPK 里不含 `bundled-dsh-plugins/`**（插件改为安装时从 npm 拉取）。所以一个只有 ~160KB 的 FPK 是正常的；本地构建（默认内置插件）会到 2MB 以上。

判断一个 FPK 是否正常，看它的 `app.tgz` 里有没有 `bundled-dsh-plugins/`：

```bash
tar -xzf <file>.fpk app.tgz && tar -tzf app.tgz | head
```

- 有 `bundled-dsh-plugins/` → 本地构建（内置插件）
- 没有 → CI 构建（瘦包，插件走 npm）

两种都能装，区别在**升级路径**：从「本地内置版」升到「CI 瘦包」时，旧 profile 里 `file:` 引用的插件归档在新包里不存在，会触发第 6 节的 ENOENT 问题。

---

## 3. 人工路径：界面上到底怎么点

```
fnOS 桌面
 └─ 打开「应用中心」
     └─ 找到目标应用（未安装时列表里没有，需要走「手动安装」）
         └─ 点左下角「手动安装」
             └─ 「从电脑上传」
                 └─ 在文件选择框里选中 .fpk
                     └─ 同意协议 → 向导「下一步」→ 等待安装
```

**两个界面事实**（都会让自动化点空）：

1. **「手动安装」在应用中心窗口的左下角**，不是顶部工具栏。
2. **DSH 应用窗口可能正开着并铺满屏幕**，把桌面上的「应用中心」图标盖住 —— 此时点桌面图标会点到应用窗口上，表现为「点了没反应」。**先关掉正在开着的应用窗口**，或直接切到应用中心窗口操作。

---

## 4. 自动化路径（Midscene）

> 本节面向用 Midscene 驱动真实 Chrome 的场景。**不要为此写一次性探测脚本**：每写一个脚本就多一次冷启动（等桥连接）、多一份一次性资产。正确做法是写成 [Midscene Test 用例](../charter/tests-spec.md) 或一个常驻脚本，一次连接跑完全流程。

### 4.1 环境就绪

| 组件 | 默认位置 | 说明 |
| --- | --- | --- |
| DSH midscene 插件桥 | `127.0.0.1:8787` | 提供模型接入配置：`GET /v1/midscene-env` 返回四行 `MIDSCENE_MODEL_*` |
| Midscene CLI 桥 | `127.0.0.1:3766` | Chrome 扩展连到这里；**同一时刻只能有一个进程占用** |
| Chrome 扩展 | Bridge 模式 | 扩展 ID `gbldofcpkknbggpkmbdaefngejllnief` |

取接入配置：

```bash
curl -s http://127.0.0.1:8787/v1/midscene-env
```

设成环境变量后即可用 `@midscene/web` 的 `AgentOverChromeBridge` 或 `midscene-test`。

### 4.2 静默：不要抢前台

后台标签页（不切到前台、不抢用户鼠标）：

```js
await agent.connectNewTabWithUrl(url, { activateTab: false })   // 新开后台标签页
await agent.page.setActiveTabId(Number.parseInt(String(id), 10), { activate: false })  // 绑定已有标签页
```

- `activate: false` 必须**显式传**。`undefined` 透传下去会落到 `connectTarget` 自己的缺省值 `true`（抢前台）—— 共享包 `defineBridgeSetup` 已把缺省改为 `?? false`，但自己写脚本时仍要显式传。
- `tabId` 必须是**数字**。传字符串会在后续所有调用上抛 `Invalid type: expected integer, found string`。

### 4.3 选标签页：不要取「第一个匹配」

同一个 URL 可能开着多个标签页（其中一份停在登录页）。`tabs.find(url => url.includes(...))` 取到的是**第一个**，很可能正是那张失效页，于是用例被绑到登录页，症状是「当前显示的是登录页面」。

用共享包的 `selectTab`（优先当前活动页），或显式挑：

```js
const tabs = await agent.getBrowserTabList()
const target = tabs.filter(t => String(t.url || '').includes('shrcn9ewk')).at(-1)
```

### 4.4 上传文件：注册与点击必须在**同一次** `aiAct`

Midscene 的文件选择器是「按次授权」的：

```js
await agent.aiAct('在「从电脑上传」区域点击「添加本地文件」', {
  fileChooserAccept: ['/abs/path/to/app.fpk'],   // 绝对路径
})
```

- `fileChooserAccept` 是 **`aiAct` 的选项**（`AiActOptions`），不是构造参数，也不是环境变量。构造参数里写它会被 JS 静默忽略。
- 路径必须是**绝对路径**；`fileChooserAllowedDir` 也是 `aiAct` 选项，用于「AI 自主决定上传哪个文件」的路径（此时会校验路径在该目录内）。直接用 `fileChooserAccept` 传绝对路径**不需要**它。
- 注册与点击要在**同一次** `aiAct` 里完成：注册只在那一次调用期间有效。

### 4.5 点击与坐标

- `aiLocate()` 返回的坐标**已归一化到 CSS 像素**，可直接用于点击。NAS 页面 `devicePixelRatio = 2`，截图宽 3840 而视口宽 1920。
- 但视觉模型偶尔会算出越界坐标（实测报 `coordinates [...] exceed normalized range [0, 1000]`），表现为动作被上游拒绝。多半是**导航步骤太重**：把「打开应用中心 → 找到应用」合并成一次 `aiAct`，比拆成 4~6 步更稳，也快得多（每一步都是一次模型调用，15–90 秒）。
- 小控件（行高 < 40px 的菜单项、页签、图标按钮）优先走**页面内 `element.click()`**（共享包的 `clickInPage` 节点）：稳定、零坐标偏差。实测药丸按钮真实位置 `(648, 893)`，而视觉定位落点曾是 `(2774, 1817)`——完全在视口外，`aiAct` 还自述「已成功点击」。

### 4.6 失败要如实报，不要静默通过

`javascript` 步骤里的 `throw` **不会让用例失败**：底层是 CDP `Runtime.evaluate`，页面异常被放进 `result.exceptionDetails` 返回而不转成错误。需要断言时用共享包的 `assertInPage` 节点（页面内精确判定 + Node 侧抛错传播，零模型调用、毫秒级），或 `aiAssert`。

### 4.7 不留痕

- **不得清除**被测站点的 Cookie / localStorage / sessionStorage / IndexedDB。被测页面是用户正在用的真实环境。
- 不得创建持久会话；需要切换会话的用例必须记住原会话并在收尾切回。
- 只删用例**自己建的**探针数据。
- 临时脚本只放 `tmp/`（git 忽略）。

---

## 5. 装完怎么验证

按「便宜 → 贵」排序，先用便宜的排除问题：

| 层次 | 检查 | 判据 |
| --- | --- | --- |
| 1. 文件层 | FPK 里有 `manifest`、`cmd/`、`app.tgz` | `tar -tzf <file>.fpk` |
| 2. 清单层 | FPK 里的 `published-dsh-plugins.json` | 项数与 `apps/fn-deepseek-harness/app/published-dsh-plugins.json` 一致 |
| 3. 界面层 | 应用中心详情页 | 版本号 = 目标版本、来源 = 手动安装 |
| 4. 模块图 | NAS 外壳 HTML 里的 `plugins/??` 引用 | 引用的插件集合与预期一致 |
| 5. 运行层 | 打开应用，界面正常 | 关键面板可打开、插件已加载 |
| 6. 日志层 | 应用日志无 `[ERROR]` | 无安装回调失败 |

> 读 NAS 外壳时注意：不要用 `[^"'&]*` 之类的字符类截断 —— `&` 会让匹配提前结束，**漏掉后面的插件**，得出「不包含 X」的错误结论。核对模块图要用完整的 `plugins/??` 引用块。

---

## 6. 排障表

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 「已安装相同或更高版本」 | 版本与 NAS 上相同或更旧 | `pnpm run version` 升版本后重新构建 |
| 安装回调报 `ENOENT ... bundled-dsh-plugins/@tnnevol/xxx.tgz` | 旧 profile 里 `file:` 引用了本次不再提供的插件归档（本地内置版 → CI 瘦包） | 见 6.1 |
| 失败升级后 `/vol1/@appcenter/<app>/` 缺 `manifest`、`cmd/` | 失败升级留下的半损坏状态，后续升级不会补回 | 应用可运行但目录不完整；介意就卸载后重装 |
| 页面停在 fnOS 登录页 | NAS 会话掉线 | 重新登录（可能需要用户本人操作） |
| 点了「手动安装」没反应 | DSH 应用窗口盖住了桌面图标 | 先关掉应用窗口 |
| 模型报 `502` / `Connection error` | 上游模型瞬时故障 | 重试；flash 模型做长规划容易翻车，换更强的模型 |
| 上传后 `fileChooser` 报错 | 路径不是绝对路径，或注册与点击不在同一次 `aiAct` | 绝对路径 + 合并到一次调用 |
| 桥端口 `EADDRINUSE 127.0.0.1:3766` | 另一个会话/进程占着桥 | 先确认是谁的再决定是否接管；不要直接杀 |

### 6.1 孤儿插件与悬空引用

安装回调在重建 Web profile 依赖前会先清理两类问题（实现见 `apps/fn-deepseek-harness/app/scripts/install-callback-helper.mjs`）：

- `orphanOwnPlugins`：profile 里**已不在发布清单**的自有插件（`@tnnevol/*`）→ 移除；
- `danglingBundledOwnPlugins`：插件**仍在清单里**、但 profile 的 `file:` 指向的 `.tgz` 在新包里**已不存在**（本地内置版 → CI 瘦包）→ 移除该 `file:` 引用。

只处理 `@tnnevol/*`；第三方插件（如 dshmarket）的清单项语义是「确保存在」，动它会破坏用户环境。

---

## 7. 装完之后：提交上架申请

装机验证通过后，按[应用上架规范](../charter/app-listing-spec.md)准备材料并填写飞书表单。要点：

- **字段取值沿用历次提交**：在表单右上角「查看提交记录」里能看到上一条提交的完整取值（应用名称、开发者、发布者、微信昵称、上架类型），保持一致即可。首次提交时没有历史值，按规范给建议值。
- **版本号填 `manifest` 的 `version`**，并留意第 1 节的「三段式」规则与本项目四段 prerelease 的冲突；审核方若以「4 段式」打回，改填三段形式（与历次提交写法一致）。
- **表单是受控组件，只认真实键入**：直接改 DOM（`native setter`、`execCommand('insertText')`）只改可见文本，**不进表单状态**，提交时校验与入库拿到的仍是旧值 —— 会出现「界面上填好了，提交后是空的或旧值」。按标签名让模型定位还会把多个值串到同一个输入框。
- **提交后必须回读「我的提交记录」核对入库值**，不能只看页面提示「提交成功」。
- 若填错需要重来：点「再填一次」拿一张干净表单（控件数量与索引会变），并到提交记录里**删除或撤销**错误的那条 —— 否则审核方先看到脏数据。

---

## 8. 一页速查

```bash
# 取得 FPK
gh release download v<版本号> --pattern "*.fpk" --dir tmp/fpk-upload

# 确认版本确实变了（对比 NAS 上已装版本）
tar -xzOf tmp/fpk-upload/*.fpk manifest | grep '^version'

# 桥与模型
curl -s http://127.0.0.1:8787/v1/midscene-env
lsof -iTCP:3766 -sTCP:LISTEN        # 只能有一个占用者

# 装完核对
tar -tzf tmp/fpk-upload/*.fpk | head          # 有没有 bundled-dsh-plugins/
tar -xzOf tmp/fpk-upload/*.fpk manifest | grep -E '^(version|platform)'
```

| 记住这几句 | 为什么 |
| --- | --- |
| 版本不同才能装 | 相同版本被直接拒绝 |
| `fileChooserAccept` 属于 `aiAct` | 放错地方被静默忽略 |
| `activate: false` 要显式传 | 缺省会抢前台 |
| tabId 必须数字、且别取第一个匹配 | 分别是调用失败与「绑到登录页」 |
| DOM 直写不进城书状态 | 提交后是旧值 |
| 提交后回读提交记录 | 页面说成功不等于入库正确 |
