# 内置技能来源与本地改动

本目录下的技能来自 Midscene 官方技能仓库，**在原文基础上做了最小补丁**：把「模型从哪来」改成 DSH 桥接服务提供的路径。

## browser-automation

| 项目 | 内容 |
| --- | --- |
| 上游仓库 | https://github.com/web-infra-dev/midscene-skills |
| 上游路径 | `skills/browser/SKILL.md` |
| 上游提交 | `dec1d1c55252ecb1a90c4ecbcfd0d2cb3ce0ac7b`（2026-08-14） |
| 同步日期 | 2026-10-12 |
| 许可 | MIT（Copyright (c) 2024-present Bytedance, Inc. and its affiliates.） |

## 本地改动（相对上游原文）

改动**只涉及「模型来源」这一件事**，技能的操作指令（命令用法、三种连接模式、workflow、best practices）保持原文：

| 位置 | 上游原文 | 本地改动 | 原因 |
| --- | --- | --- | --- |
| `## Prerequisites` 整节 | 给出四个 `MIDSCENE_MODEL_*` 变量模板，并列 Gemini / Qwen / 豆包三个第三方服务商的完整示例（含各自的 API key 占位符），末尾写「若模型未配置，请让用户去设置」 | 替换为三步走：① 探测本地桥健康检查 ② 用 `/v1/midscene-env` 直接生成 `.env` ③ 从 `/v1/models` 挑 `vision: true` 的模型；并明确「不要向用户索要模型 API key、不要配置第三方提供方」 | **本插件的存在意义就是让 Midscene 用 DSH 已有的模型**。原文会让 agent 去要 Gemini/豆包 key，与产品定位直接冲突；用户不需要、也不应该准备这些凭据 |
| frontmatter `description` 末尾 | `Powered by Midscene.js (https://midscenejs.com)` | 追加一句：模型访问由 DSH Midscene Bridge 提供（本地、无需 API key），不要向用户索要 key 或配置第三方提供方 | description 是技能被发现时最先进入模型上下文的内容，改动指引必须在这里也可见，否则 agent 可能只读描述就去找 key |
| `### API Key Errors` 小节 | 「检查 `.env` 里的 `MIDSCENE_MODEL_API_KEY=<your-key>`；确认 key 对所选服务商有效」 | 重写为桥接场景的排错表：占位 key 说明、桥未运行的判断、`MISSING_CREDENTIAL`/`QUOTA` 的处理、family 不匹配的定位症状、无图片能力模型 | 原文的排错方向（换 key、验 key）在桥接场景下全是错的方向，会把用户引向「配一个第三方模型」 |

`MIDSCENE_MODEL_FAMILY` 的上游链接（`model-common-config`）保留在改动后的 Prerequisites 末尾，但降级为「背景参考」——家族取值本身仍需 Midscene 文档作为权威来源。

## 同步方式（上游更新时）

```bash
git clone --depth 1 https://github.com/web-infra-dev/midscene-skills.git /tmp/midscene-skills
cp /tmp/midscene-skills/skills/browser/SKILL.md \
   plugins/dsh-midscene-plugin/skills/browser-automation/SKILL.md
# 然后按上表重新施加三处改动，并更新本文件的「上游提交 / 同步日期」
```

同步后必须重新施加上述三处改动——直接覆盖会把第三方 key 配置带回来。改动点已尽量收敛（一节 + 一句 + 一小节），便于上游更新时快速重做。

## 只内置 Web 场景技能

上游仓库另有 `android-automation`、`ios-automation`、`harmony-automation`、`computer-automation`、`vitest-midscene-e2e` 五个技能。本插件**只内置 `browser-automation`**：需求「不在本次范围内」明确不承诺 YAML 运行器的非 Web 平台场景（Android/iOS/HarmonyOS/Computer 等），只承诺 Web 场景；内置未承诺能力的技能会让用户以为可用。需要移动端/桌面自动化的用户可按上游仓库自装（`npx skills add web-infra-dev/midscene-skills`）。

## 与用户自装技能的关系

插件注册的技能在 dsh 技能发现优先级里排在项目目录与用户目录（`~/.agents/skills/` 等）之后，因此用户自行安装的同名技能天然胜出，插件不覆盖、不重复提示（需求 FNOS-013-13-AC-04）。用户自装的版本是上游原文，不含本插件的桥接改动——那种情况下模型来源由用户自己负责。
