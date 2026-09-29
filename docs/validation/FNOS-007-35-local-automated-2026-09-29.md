---
feature: FNOS-007-35
acceptance: FNOS-007-35-AC-01, FNOS-007-35-AC-02, FNOS-007-35-AC-03, FNOS-007-35-AC-04
environment: 本地真实 llm-pi-ai 启动 + 真实 DSH profiles 解析
fnosVersion: 不适用
appVersion: 5.4.3
pluginVersion: 5.4.3
verifiedAt: 2026-09-29
status: passed
---

# FNOS-007-35 Codex 模型能力元数据补全本地验证记录（2026-09-29）

本记录是**本地与源码级证据**。「在真实客户端里看到思考等级下拉出现新模型」属于界面验收，
需要在安装了插件的 DSH Desktop / NAS 上复核（见「未完成部分」）。

## 缺陷与根因

用户报告：Codex 插件模型已更新，但**新模型没有思考等级**。

根因不在插件 UI，而在 `cordis.patch.yml` 的 `models` 声明方式。`llm-pi-ai` 的
`resolveEntry()` 按下面顺序取模型能力：

```js
const base = defaults.get(entry.id);                     // 按 id 查 DSH 内置 pi-ai 目录
input:  declaredInput(entry.input) ?? base?.input ?? [...request.defaultInput],   // 默认 ["text"]
contextWindow: entry.contextWindow ?? base?.contextWindow ?? request.defaultContextWindow, // 默认 262144
...resolveModelReasoning(provider, entry, base)          // 未声明 efforts → base?.reasoning ?? false
```

而配置里的 `models` **整体替换**内置目录（源码注释：`a declared route spells every model out in
its models list`），因此「只写 `id` + `name`」的条目能不能拿到能力，完全取决于内置目录是否
恰好收录该 ID。

`gpt-6-sol` 与 `gpt-6-luna` 在 pi-ai 的 Codex 目录中**不存在**（实测 `0.85.1`~`0.87.0`，
`0.87.1` 才补入），于是这两条回落成：

| 字段 | 回落值 | 用户可见后果 |
| --- | --- | --- |
| `reasoning` | `false` | 模型选择器没有思考等级 |
| `input` | `["text"]` | 不能传图 |
| `contextWindow` | `262144` | 上下文窗口小于模型真实值 |

其余五个模型（`gpt-6-astra`、`gpt-5.6-sol/terra/luna`、`gpt-5.5`）恰好在目录中，所以
「只有新模型缺思考等级」——与用户描述完全一致。

### 上游是否已修复（本次核实结论）

| 包 | 版本 | 结论 |
| --- | --- | --- |
| `@deepseek-ai/dsh-llm-pi-ai` | `0.2.0-rc.1`（`next`，现行最新） | **未改**。`resolveModelReasoning`、`DEFAULT_INPUT`、`resolveEntry` 的回落链与 `0.1.7-rc.2` 逐字节相同；这是设计选择（能力属模型级，必须由目录或 profile 提供） |
| `@earendil-works/pi-ai` | `0.87.1` | **已补**。`0.85.1`/`0.86.0`/`0.86.1`/`0.87.0` 的 Codex 目录均无 `gpt-6-sol`、`gpt-6-luna`，`0.87.1`（2026-09-22）加入，并带完整 `reasoning: true`、`input: ["text","image"]`、`contextWindow: 272000`、`maxTokens: 128000`、`thinkingLevelMap` |

因此**升级依赖不能解决问题**：运行时用的是宿主 DSH 自带的 pi-ai（本机实测
`~/.nvm/.../lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai` = `0.85.1`），
插件把 pi-ai 声明为 `peerDependency` 并在 `tsdown.config.ts` 中 `neverBundle`，改仓库 pin 只影响
本地测试。在 profile 里显式声明能力才能既治当前版本、又不依赖宿主的 pi-ai 版本。

## 本次实现

给 `cordis.patch.yml` 的七个条目补上逐模型的 `input`、`contextWindow`、`maxTokens` 与
`reasoningEfforts`，取值对齐 pi-ai `0.87.1` 的 Codex 目录（该目录同时是这两个模型的事实来源）。

`off` 必须按模型区分三种写法，它们语义不同：

| 写法 | pi-ai 视角 | 用于 |
| --- | --- | --- |
| 不声明 `off` | 被固定为 `null` → 不支持 | `gpt-6-astra`（目录中 `off: null`） |
| `off: null` | 不进入 map → 支持，且**不发送**思考参数 | 除 astra 外的六个模型 |
| `off: none` | 发送字面量 `"none"` | Codex 文档中 `off` 需要具体值的场景 |

`minimal` 统一映射为 `low`（目录的 `minimal: "low"`），`xhigh`/`max` 只在模型确有该等级时声明
（`gpt-5.5` 无 `max`）；`max` 之外的等级在 `xhigh`/`max` 缺失时不会被错误开放，因为
`getSupportedThinkingLevels` 对这两个等级要求 map 中有定义。

## 验证证据

### 真实启动 A/B（决定性）

用真实 `@deepseek-ai/cordis` 启动真实 `dsh-llm` + `dsh-llm-pi-ai`，加载 `cordis.patch.yml`
（经 `js-yaml` 解析 + `llm-pi-ai` 的 `Config()` 校验），再经 **`PiAiAdapter.resolveModel()`
读回**——即 Models 页与模型选择器同源的数据：

| 模型 | 修复前 `input` / `ctx` / efforts | 修复后 `input` / `ctx` / efforts |
| --- | --- | --- |
| `gpt-6-sol` | `["text"]` / `262144` / **NONE（缺失）** | `["text","image"]` / `272000` / `off/minimal/low/medium/high/xhigh/max` |
| `gpt-6-luna` | `["text"]` / `262144` / **NONE（缺失）** | `["text","image"]` / `272000` / `off/minimal/low/medium/high/xhigh/max` |
| `gpt-6-astra` | `["text","image"]` / `272000` / `minimal/…/max` | 不变（已正确） |
| `gpt-5.6-sol` | `["text","image"]` / `272000` / `off/…/max` | 不变（已正确） |
| `gpt-5.5` | `["text","image"]` / `272000` / `off/…/xhigh` | 不变（已正确） |

修复后七个模型均为 `input=["text","image"]`、`ctx=272000`、`max=128000`。

### 验收条件对照

| 验收条件 | 证据 | 结果 |
| --- | --- | --- |
| FNOS-007-35-AC-01 | `tests/host/model-capabilities.spec.ts` 逐条断言七个模型的 `input`、`contextWindow`、`maxTokens` 与思考等级 | 通过 |
| FNOS-007-35-AC-02 | 真实启动读回 `gpt-6-sol`、`gpt-6-luna` 的 efforts 非空、`input` 含 `image`、`ctx=272000`；修复前为 `NONE`/`["text"]`/`262144` | 通过 |
| FNOS-007-35-AC-03 | 能力写在 profile 的 `models` 条目上，正是「恢复默认模型」清空覆盖后回落的那份静态声明 | 通过 |
| FNOS-007-35-AC-04 | 测试分别断言 astra 不声明 `off`、sol/luna 用 `off: none`、其余用 `off: null` | 通过 |

## 红绿验证

| 变体 | `model-capabilities.spec.ts` | 真实启动读回 sol/luna |
| --- | --- | --- |
| 修复前（`HEAD` 的只写 `id`/`name` 版本） | 3 例中 **2 例失败** | efforts `NONE`、`input=["text"]`、`ctx=262144` |
| 当前实现 | 3 例全部通过 | efforts 七级、`input=["text","image"]`、`ctx=272000` |

## 命令与结果

```text
pnpm --filter @tnnevol/dsh-codex-auth run test        # 20 files, 105 tests 全部通过
pnpm --filter @tnnevol/dsh-codex-auth run typecheck   # 通过
# 真实启动复核（js-yaml + 真实 cordis + 真实 PiAiAdapter.resolveModel）
# 见上文 A/B 表
```

## 未完成部分

- 未在真实 DSH Desktop / NAS 上打开模型选择器肉眼确认思考等级下拉；本记录只证明
  适配器对外暴露的模型信息已正确。
- `gpt-6-sol`、`gpt-6-luna` 的能力值取自 pi-ai `0.87.1` 的内置目录，未用真实账号的
  `chatgpt.com/backend-api/codex/models` 返回复核（本机该接口无登录态返回 `401`）。若真实账号
  提供的等级与此不同，登录后的自动同步会以账号目录为准覆盖。
- 未修改官方 Models 页的「API 密钥」「自定义设置」「获取可用模型」「恢复默认模型」等界面，
  这些属于上游 `@deepseek-ai/dsh-client-ui-settings-models`，插件不在该页渲染内容，官方只提供
  追加型座位。

## 回滚

还原 `cordis.patch.yml` 为只写 `id`/`name` 的版本即可；不涉及凭据、账号或持久化数据。
