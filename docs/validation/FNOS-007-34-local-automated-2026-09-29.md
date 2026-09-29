---
feature: FNOS-007-34
acceptance: FNOS-007-34-AC-01, FNOS-007-34-AC-02, FNOS-007-34-AC-03, FNOS-007-34-AC-04
environment: 本地构建产物与官方 DSH token 表核对
fnosVersion: 不适用
appVersion: 5.4.3
pluginVersion: 5.4.3
verifiedAt: 2026-09-29
status: passed
---

# FNOS-007-34 气泡浮层磨砂背景修复本地验证记录（2026-09-29）

本记录是 **本地与源码级证据**。「在真实 DSH 客户端里肉眼确认磨砂观感」属于视觉验收，本机未能截图（原因见「未完成部分」），需要在真实客户端复核。

## 环境与前置

- 仓库：`fn-packages/fnos-dsh`，共享包 `@tnnevol/dsh-semi-ui`。
- 上游契约依据：已安装的 `@deepseek-ai/dsh-client-ui-theme@0.1.7-rc.2` 与 `@deepseek-ai/dsh-client-ui-primitives@0.1.7-rc.2` 产物。
- 浏览器支持度依据：仓库内 `caniuse-lite@1.0.30001810` 的 `css-backdrop-filter` 数据集。

## 缺陷与根因

DSH 把菜单类表面 token 换成了带透明度的填充值：

| DSH 版本 | `--dsw-specific-menu` 的取值 |
| --- | --- |
| `0.1.5-rc.2` | `var(--dsw-alias-bg-layer-3)` —— 不透明 |
| `0.1.7-rc.2` | `var(--dsw-menu-surface-fill)` —— 浅色 `#f8f9fa94`（约 58%）、深色 `#43454a73`（约 45%） |

`@tnnevol/dsh-semi-ui` 把 `--dsw-specific-menu` 用作 `.semi-popover-wrapper` 的 `background`。token 变成半透明后，气泡本身失去遮挡能力，背后的页面内容直接透出。

官方对同一 token 的既定用法是**成对使用**：`@deepseek-ai/dsh-client-ui-primitives` 的 `HoverCard.module.css` 在 `background: var(--dsw-specific-menu)` 的同一规则里写了 `backdrop-filter: var(--dsw-menu-backdrop-filter)`，该变量在 `body` 上定义为 `blur(40px) saturate(150%)`。我们此前只取了背景色，漏掉了配套的磨砂。

## 本次实现

1. `.semi-popover-wrapper` 增加 `backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))`。用官方变量而非写死数值，避免与上游漂移；回退值保证变量缺失时仍有磨砂。
2. `-webkit-backdrop-filter` 放入独立的 `@supports (-webkit-backdrop-filter: blur(1px))` 规则。

第 2 点是本记录中唯一需要说明技巧的地方：**标准属性与前缀写法写在同一个声明块里，会被构建流程静默去重，只剩后者**。实测 `lightningcss` 对 `.x{-webkit-backdrop-filter:B;backdrop-filter:B}` 的输出是 `.x{backdrop-filter:B}`，即前缀声明消失。因此「在源码里并排写两行」看似正确、产物里却完全没有前缀。用 `@supports` 隔离后构建产物同时包含两者。

## 验证证据

| 验收条件 | 证据 | 结果 |
| --- | --- | --- |
| FNOS-007-34-AC-01 | `lib/style.css` 中 `.semi-popover-wrapper` 规则保留 `background:var(--dsw-specific-menu)` 且新增 `backdrop-filter` | 通过 |
| FNOS-007-34-AC-02 | 断言使用 `var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%))`，未写死数值 | 通过 |
| FNOS-007-34-AC-03 | 断言 `lib/style.css` 同时含 `-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,…)` 与 `@supports` 守卫；并断言源码同块内不含前缀 | 通过 |
| FNOS-007-34-AC-04 | 四个消费插件重建后 `lib/client.js` 均含 1 处 `-webkit-backdrop-filter`，且 `dsh-fnos` 产物中出现前缀规则与 `@supports` 块 | 通过 |

### 浏览器支持度依据

`caniuse-lite` 的 `css-backdrop-filter` 在 Safari 的标注：`15.6`、`16.0`、`16.6`、`17.0`、`17.6` 均为 `y x`（`x` 表示需要前缀），`18.0` 起为 `y`。因此 Safari 18 之前的用户只有前缀写法才能生效，补前缀是必要项而不是保险项。

## 红绿验证

在 `packages/dsh-semi-ui` 内实测，两种失败写法都会被测试抓住：

| 写法 | `lib/style.css` 中的 `-webkit-backdrop-filter` 计数 | 测试结果 |
| --- | --- | --- |
| 完全不加 `backdrop-filter`（修复前状态） | 0 | 5 例中 4 例失败 |
| 标准属性与前缀同块并列（看似正确） | **0**（被构建去重） | 5 例中 2 例失败 |
| 当前实现（`@supports` 隔离） | 1 | 5 例全部通过 |

测试断言的是 **`lib/style.css` 构建产物**而非 SCSS 源码。这一点是刻意的：如果断言源码，第二种写法会「通过源码断言、丢失产物前缀」，正好漏掉本次的坑。

## 命令与结果

```text
pnpm --filter @tnnevol/dsh-semi-ui run typecheck   # 通过
pnpm --filter @tnnevol/dsh-semi-ui run test        # 4 files, 11 tests 全部通过
pnpm exec eslint packages/dsh-semi-ui              # 0 error
pnpm exec turbo run build --filter=@tnnevol/dsh-codebuddy --filter=@tnnevol/dsh-codex-auth \
  --filter=@tnnevol/dsh-fnos --filter=@tnnevol/dsh-semi-ui-showcase   # 5 tasks successful
# 下游插件测试：codebuddy 888、codex-auth 100、fnos 155、semi-ui-showcase 39，全部通过
```

## 未完成部分

- **真实客户端视觉验收**：本记录只证明产物中存在正确的声明，没有证明肉眼观感。尝试用本机 Chrome 无头模式截图时，浏览器进程无法在沙箱内创建 profile socket 目录（`Failed to create socket directory`），截图未产出；因此「磨砂强度是否合适」「箭头与气泡边缘是否协调」需要真实 DSH 客户端确认。
- **透明度是否应回调**：本次沿用官方 token 值、只补磨砂，未改动 `--dsw-specific-menu` 本身。若在真实客户端上仍觉得过透，应优先与官方对齐（例如同时使用官方的 `--dsw-elevation-panel`/`[data-menu-material]` 组合），而不是在本包内写死更实的颜色。
- **其他半透明 token 未逐一核对**：本次按用户报告的范围只处理了使用 `--dsw-specific-menu` 的气泡浮层。仓库其他位置使用 `--dsw-alias-bg-mask-1`（半透明遮罩，本就该透）等变量，未发现同类问题，但未做全量审计。

## 验收人

- 本地构建、官方 token 核对与自动化验证：本次会话（Lead）。
- 真实客户端观感结论：待执行。
