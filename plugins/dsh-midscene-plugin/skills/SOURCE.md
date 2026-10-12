# 内置技能来源

本目录下的技能内容来自 Midscene 官方技能仓库，**原样分发、不做改写**
（需求 FNOS-013-13 行为约束：内置技能只做分发不做改写）。

## browser-automation

| 项目 | 内容 |
| --- | --- |
| 上游仓库 | https://github.com/web-infra-dev/midscene-skills |
| 上游路径 | `skills/browser/SKILL.md` |
| 上游提交 | `dec1d1c55252ecb1a90c4ecbcfd0d2cb3ce0ac7b`（2026-08-14） |
| 同步日期 | 2026-10-12 |
| 文件 sha256（前 16 位） | `9aa7c602a7004e53` |
| 许可 | MIT（Copyright (c) 2024-present Bytedance, Inc. and its affiliates.） |

## 同步方式

上游更新时随插件版本迭代重新同步：

```bash
git clone --depth 1 https://github.com/web-infra-dev/midscene-skills.git /tmp/midscene-skills
cp /tmp/midscene-skills/skills/browser/SKILL.md \
   plugins/dsh-midscene-plugin/skills/browser-automation/SKILL.md
```

同步后更新本文件的「上游提交 / 同步日期 / sha256」三项。

## 只内置 Web 场景技能

上游仓库另有 `android-automation`、`ios-automation`、`harmony-automation`、
`computer-automation`、`vitest-midscene-e2e` 五个技能。本插件**只内置
`browser-automation`**：需求「不在本次范围内」明确不承诺 YAML 运行器的非
Web 平台场景（Android/iOS/HarmonyOS/Computer 等），只承诺 Web 场景；内置
未承诺能力的技能会让用户以为可用。需要移动端/桌面自动化的用户可按上游
仓库自装（`npx skills add web-infra-dev/midscene-skills`）。

## 与用户自装技能的关系

插件注册的技能在 dsh 技能发现优先级里排在项目目录与用户目录（`~/.agents/skills/`
等）之后，因此用户自行安装的同名技能天然胜出，插件不覆盖、不重复提示
（需求 FNOS-013-13-AC-04）。
