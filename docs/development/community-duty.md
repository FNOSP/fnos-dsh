# 社区值班

本页说明 `FNOSP/fnos-dsh` 社区值班自动化任务的运行方式、判定口径和硬性约束。值班由 **DSH 自动化任务**（schedule，cron 定时）驱动，到点把值班提示投递回值班会话；仓库内只保留一个确定性助手脚本负责取数、发评论和去重，**判断与措辞由值班会话负责**。

## 值班节奏

- DSH 自动化任务「fnos-dsh 社区值班」，cron 表达式 `0 */4 * * *`（时区 `Asia/Shanghai`），即本地时间 00:00 / 04:00 / 08:00 / 12:00 / 16:00 / 20:00 各触发一轮，提示投递回创建它的值班会话。
- 每轮范围：`FNOSP/fnos-dsh` 的 open issues、open PRs、discussions。
- 本轮没有待处理事项时**直接结束**：不建卡、不评论、不回复。
- 定时由 DSH 宿主调度，宿主停机期间错过的窗口只在恢复后补投一次；自动化任务绑定值班会话，会话归档后需重新创建。

## 一轮的标准动作

| 步骤 | 动作 | 说明 |
| --- | --- | --- |
| 1. 取数 | `node scripts/community-duty.mjs scan` | 输出 JSON：`pending`（待处理）、`skipped`（已答复/维护者自述等）、`rateLimit`（剩余额度） |
| 2. 分流 | 按下方口径逐条判定 | 简单问题可自动回复；复杂或高风险一律不回复 |
| 3. 回复 | 正文写入 `tmp/community-duty/outbox/<key>.md`，再执行 `node scripts/community-duty.mjs reply --key issue#16 --body-file tmp/community-duty/outbox/issue#16.md` | 脚本自动追加 `<!-- dsh-bot:v1 -->` 签名；发布前做本地内容拦截 |
| 4. 建卡 | `taskboard_create` | 已自动回复的卡片状态 `in_review`（待验收）；需人工处理的卡片状态 `todo`。看板卡只用于跟踪已处理事项，定时本身由 DSH 自动化任务负责，看板不挂定时卡 |
| 5. 登记 | `node scripts/community-duty.mjs mark --key issue#16 --status replied --card <卡片ID>` | 状态写入本地台账，下一轮据此去重 |
| 6. 交接 | `taskboard_execution_report` + `taskboard_comment_add` | 记录本轮处理了哪些事项、如何判定、剩余风险 |

第 1 步的 `pending` 已经过滤掉：维护者自己发布的说明、维护者已经答复过的事项、已带机器人签名的事项、以及本地台账里已处理且之后没有新评论的事项。

## 分流口径

| 判定 | 典型情形 | 处置 |
| --- | --- | --- |
| 简单问题 | 安装/升级/版本号/用法/文档位置类，能给出确定答案，不涉及风险决策 | 自动回复 → 卡片 `in_review` |
| 复杂或高风险 | 需要看日志才能定位、复现条件不明、涉及代码改动或升级策略、涉及权限/安全/数据处理、受上游平台限制、PR 与需要改代码的讨论 | 不回复 → 卡片 `todo` 交人工 |

回复只写**结论 + 操作步骤 + 文档链接**，不贴本地文件原文；确实需要用户补充信息时，明确列出要哪段日志、哪一行输出，并提示隐去账号与令牌。

## 硬性约束

1. **绝不把本地任何文件内容上传到 GitHub**。脚本在发布前做三重拦截：正文文件不能是仓库内文件；正文与本地文件逐行比对，命中即拒绝；正文出现本机绝对路径即拒绝。
2. **只写评论**。脚本对 GitHub 的写操作只有「新增评论」一个（issue/PR 走 REST，Discussion 走 GraphQL `addDiscussionComment`）。不 push、不 merge、不改 label、不改 issue 状态。
3. **回复必须带签名**。`<!-- dsh-bot:v1 -->` 由脚本统一追加，避免漏签。
4. **网络抖动自动重试**。连接重置、超时、5xx 自动重试 3~5 次（默认 5 次尝试，退避 1s/3s/9s/27s）；触发限流时中止并报出 `rate_limit` 剩余额度。未认证时 GitHub core 限流为 60/h，认证后为 5000/h。

## 脚本命令

| 命令 | 用途 |
| --- | --- |
| `node scripts/community-duty.mjs scan` | 列出本轮待处理事项（JSON） |
| `node scripts/community-duty.mjs reply --key <issue#16> --body-file <文件> [--dry-run]` | 发布自动回复；`--dry-run` 只做拦截检查与签名预览 |
| `node scripts/community-duty.mjs mark --key <issue#16> --status replied\|manual\|ignored [--card <卡片ID>]` | 登记处理结果，供下一轮去重 |
| `node scripts/community-duty.mjs state` | 打印本地台账摘要 |
| `node scripts/community-duty.mjs rate-limit` | 打印 API 剩余额度 |

环境变量：`DUTY_REPO`（默认 `FNOSP/fnos-dsh`）、`DUTY_WORKSPACE`（默认当前目录）、`DUTY_STATE_DIR`（默认 `tmp/community-duty`）、`DUTY_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN`（未设置时回退到 `gh auth token`）、`DUTY_MAX_ATTEMPTS`（3~5）。

## 本地台账

| 路径 | 内容 |
| --- | --- |
| `tmp/community-duty/state.json` | 已处理事项台账（状态、卡片 ID、处理时间），下一轮据此去重 |
| `tmp/community-duty/outbox/` | 回复正文暂存区；只有这里的正文才允许发布 |

`tmp/` 已被 Git 忽略，清理 `tmp/` 会重置台账，下一轮会重新按 GitHub 上的实际状态判断，不会重复回复已带签名的评论。

## 手动补跑

- 值班会话里直接说明「现在补跑一轮社区值班」即可按上面的标准动作走一轮。
- 只补跑取数不发评论：`node scripts/community-duty.mjs scan`。
- 只验证正文能否发布：`node scripts/community-duty.mjs reply --key <key> --body-file <文件> --dry-run`。
