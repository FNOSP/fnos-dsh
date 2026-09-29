---
feature: FNOS-007-35
acceptance: FNOS-007-35-AC-05, FNOS-007-35-AC-06
environment: 本地真实 DSH 启动（真实 profile + 真实设置服务写入）+ 客户端桥接单测
fnosVersion: 不适用
appVersion: 5.4.3
pluginVersion: 5.4.3
verifiedAt: 2026-09-29
status: passed
---

# FNOS-007-35 Codex 模型能力单一来源与历史覆盖自愈本地验证记录（2026-09-29）

本记录承接 [`FNOS-007-35-local-automated-2026-09-29`](/validation/FNOS-007-35-local-automated-2026-09-29)。
上一记录修好了**插件基线**（`cordis.patch.yml` 里七个模型都写全了能力），但用户看到的
灰色 `256K`/`32K` 占位与「图片不可选」仍然存在。本记录说明为什么，以及这次改了什么。

本记录是**本地与源码级证据**。真实客户端里肉眼确认下拉项属于界面验收，见「未完成部分」。

## 为什么补好基线还不够：一条完整的因果链

问题不是两个，是一个。按发生顺序：

1. **候选只带身份。** 官方 Models 页的「获取可用模型」弹框，其候选来自本插件的客户端桥接
   `installCodexModelDiscoveryBridge`。桥接的数据源是 `session.modelCatalog`，而宿主
   `buildModelCatalog()`（`dsh-api-session-controller`）对每个模型只发布
   `{ id, name, description?, reasoning }`——**没有** `contextWindow`/`maxTokens`/`inputModalities`。
   旧桥接于是只回传 `{ id, name }`。

2. **候选决定新行的能力。** 官方弹框的 `adopt(candidate)` 只从候选项取
   `id`/`name`/`contextWindow`/`maxTokens`/`input`（`input` 来自 `candidate.inputModalities`）。
   候选项没有这些字段，生成的新行就没有——Models 页随即将该行渲染成未填写的容量输入框
   （灰色占位）与只勾「文本」的输入类型。

3. **保存即写进用户层。** 弹框保存走 `settings.mutate(...)`。`dsh-settings` 的 `describe()`
   把 profile 的 `cordis.patch.yml` 里对应 id 的 `config` 作为 **user 层**（`dsh-config-editor`
   `configuration()` 的 `override`），而 `documentPath` 正是
   `profileContext.patchPath` = `<DSH_HOME>/profiles/<name>/cordis.patch.yml`。所以用户层就是
   这份 profile 补丁文件本身，不是另一个存储。

4. **数组整体替换。** `llm-pi-ai` 的解析链是
   `entry.contextWindow ?? base?.contextWindow ?? request.defaultContextWindow`（`base` 是按 id 查
   内置目录的结果），而 `models` 整体替换目录。用户层一旦存在 `models`，它**完全遮蔽**上一步
   修好的插件基线——即使插件补丁里能力是齐的。

5. **「恢复默认模型」无能为力。** 该按钮只做 `schema.deletePath(current, ["models"])`，即删掉整段
   覆盖。删掉之后配置回落到插件基线（本次实测：能正确回到 7 条完整能力），但它不能把能力
   「补进」用户已有的列表——用户的 7 行还是那 7 行缺能力的行，除非用户愿意丢掉自己的列表。

结论：**只修基线（第 4 步）不会改变任何现象**，因为遮蔽发生在用户层；而要堵住源头，必须同时
修第 1 步（候选带能力）并清理第 3 步已经写进用户层的残缺数据。

## 本次实现

### 一、能力收敛为单一事实来源（`src/contracts/model-capabilities.ts`）

新增契约文件，持有七个模型的能力；补丁条目与客户端桥接都从它取值。为防止两份副本漂移，
`tests/host/model-capabilities.spec.ts` 增加两例：一例逐字段比对「补丁 ↔ 契约」，一例断言契约
本身的取值（防止两边一起改错）。

### 二、候选恢复携带完整能力（`src/client/services/model-discovery.ts`）

桥接改为返回完整能力：**契约优先**，并用适配器自带目录
（`getBuiltinModels`，即 pi-ai 静态表，走同一 `original` 调用、失败只降级）补齐契约尚未收录的
新 id。列表查询失败时不丢候选，只丢补全——候选为空的后果是用户看不到任何可添加模型。

### 三、历史残缺覆盖自愈（`src/host/model-capability-heal.ts`）

插件启动时读一次用户层，只对**缺失**的能力字段补值，然后只 patch `models` 键。约束：

- 用户已设的值（含刻意改小的窗口、刻意只留文本）一律不覆盖；
- 不增删改模型，顺序与显示名保持用户原样；
- 契约未收录的 id 不动（宁可缺失也不猜）；
- 无可补时不做任何写入 → 幂等，写入不会回声成第二次写入；
- 命名空间尚未挂载时监听一次 `settings/document-updated` 重试，成功即断开（一次性，
  避免在用户编辑时抢写导致 revision 冲突）；
- 失败只记 warning，不影响插件激活与启动。

## 验证证据

### 一、漂移门确实会红（变异测试）

| 变异 | 结果 |
| --- | --- |
| 补丁删掉 `gpt-6-luna` 的 `maxTokens`（契约不动） | **2 例失败**（含漂移门） |
| 契约把 `gpt-6-sol` 的 `off` 由 `none` 改成 `null`（补丁不动） | **2 例失败**（含漂移门） |
| 还原 | 5 例全部通过 |

### 二、桥接能力的红绿（旧实现对照）

| 变体 | `tests/client/model-discovery.spec.ts` |
| --- | --- |
| 旧实现（只回传 `{id, name}`） | 9 例中 **5 例失败** |
| 当前实现 | 9 例全部通过 |

### 三、真实启动自愈（决定性）

取本机真实 profile 的副本（其 `llm-pi-ai.models` 为 7 条缺能力字段的行，`contextWindow` 计数 0），
用**真实 DSH 启动** `dsh --profile web`，再读回文件与有效配置：

| 观测点 | 启动前 | 启动后 |
| --- | --- | --- |
| profile 补丁中 `contextWindow` | 0 | 7 |
| profile 补丁中 `maxTokens` | 0 | 7 |
| profile 补丁中 `reasoningEfforts` | 0 | 7 |
| 有效配置 dump 中 `272000` | 0 | 7 |
| 有效配置 dump 中 `reasoningEfforts` | 0 | 7 |

改动性质经 diff 核对为**纯新增**：删除行 0、新增行 69；用户原有的 `compat.chatTemplateKwargs`
与 `ui-theme`/`agent-default-model` 等设置逐字保留。

**幂等**：第二次真实启动前后文件 mtime 与内容完全一致（未再次写入）。

### 四、验收条件对照

| 验收条件 | 证据 | 结果 |
| --- | --- | --- |
| FNOS-007-35-AC-05 | 漂移门双向变异各自变红；桥接契约优先于适配器；自愈只从同一契约取值 | 通过 |
| FNOS-007-35-AC-06 | 真实启动把残缺覆盖补齐（上表）；10 例自愈单测覆盖「不覆盖用户值」「保留自有模型/顺序/名称」「契约外 id 不动」「幂等」 | 通过 |

## 命令与结果

```text
pnpm --filter @tnnevol/dsh-codex-auth run check        # 21 files, 120 tests 全部通过
pnpm exec eslint plugins/dsh-codex-auth-plugin         # 0 errors（5 个既有 warning 在未改动文件）
pnpm exec vitepress build docs                          # 通过
git diff --check                                        # 干净
# 真实启动自愈 A/B：DSH_HOME=<profile 副本> dsh --profile web（见上表）
```

## 未完成部分

- 未在真实 DSH Web / Desktop 上肉眼确认灰色占位消失；本记录证明的是写入用户层与有效配置的
  数据已正确。
- 本机活动 profile（`.dsh/profiles/web`，仓库内、已被 git 忽略）已按同一路径自愈，但该文件属于
  运行时状态、不进入版本库。
- **Desktop 应用的 profile 由 Electron 独占管理**（`--dump-config` 直接拒绝），无法从命令行读回或
  自愈；其 `cordis.patch.yml` 当前不含 `llm-pi-ai` 覆盖，组合结果实测为 7 条完整能力，故本次截图
  中的灰色占位在该 profile 上已不再由基线缺失导致。若 Desktop 上仍复现，需要走它的界面确认。
- 账号侧 `chatgpt.com/backend-api/codex/models` 的真实能力值未复核（本机 401）；账号同步写回的
  条目以账号目录为准。
- 未改动官方 Models 页的按钮、弹框与复选框行为（用户已确认暂不处理）。

## 回滚

客户端桥接与自愈均为新增文件/新增分支，删除 `src/contracts/model-capabilities.ts`、
`src/host/model-capability-heal.ts` 并还原两处改动即可；已写入用户层的能力字段是补全值，
保留它们与插件基线一致，无需回滚数据。
