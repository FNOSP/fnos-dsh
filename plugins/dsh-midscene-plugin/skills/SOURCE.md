# 内置技能来源

本目录内置 **8 个技能**：**7 个来自上游**（与上游逐字节一致，不含任何本地补丁），
外加 **1 个插件自有技能** `dsh-midscene`（**不是**上游内容，不参与上游同步）。

| 技能 | 上游 | 定位 |
| --- | --- | --- |
| **`dsh-midscene`** | **插件自有** | **本环境入口**：模型由插件的桥提供、不索要密钥、优先用用户自己的 Chrome |
| `browser-automation` | [`web-infra-dev/midscene-skills`](https://github.com/web-infra-dev/midscene-skills) | 浏览器自动化（Puppeteer / CDP / Bridge 三种模式） |
| `computer-automation` | 同上 | 桌面控制（macOS / Windows / Linux，本地模式会接管真实鼠标键盘） |
| `android-automation` | 同上 | Android 设备控制（ADB） |
| `ios-automation` | 同上 | iOS 设备控制（WebDriverAgent） |
| `harmony-automation` | 同上 | HarmonyOS 设备控制（HDC） |
| `vitest-midscene-e2e` | 同上 | 用 Vitest + Midscene 写跨平台 E2E（自带 `references/` 与 `scripts/`） |
| `midscenejs` | [`tnnevol/skills`](https://github.com/tnnevol/skills)（`skills/midscenejs`） | 知识与 API 参考：概念、模型与 FAMILY、平台接入、Agent API、YAML 运行器、Midscene Test |

前 6 个（官方 Midscene Skills）与第 7 个互补：前者是**操作指令**（怎么用 CLI 干活），后者是**查阅资料**（是什么、API 怎么用、报错怎么办）。上游 `midscenejs` 提炼自 Midscene 主仓库的中文文档源，版本节奏跟随 Midscene 发布（见其 `GENERATION.md`）。

## 上游版本

| 技能组 | 上游仓库 | 上游路径 | 上游提交 | 同步日期 | 许可 |
| --- | --- | --- | --- | --- | --- |
| 官方 6 个 | https://github.com/web-infra-dev/midscene-skills | `skills/*`（6 个目录） | `dec1d1c55252ecb1a90c4ecbcfd0d2cb3ce0ac7b`（2026-08-14） | 2026-10-13 | MIT（Copyright (c) 2024-present Bytedance, Inc. and its affiliates.） |
| `midscenejs` | https://github.com/tnnevol/skills | `skills/midscenejs/` | `b2616bbe0d587d4a5847ef7143d2da447ce9df02`（2026-10-12） | 2026-10-12 | 见上游仓库 |

> 目录名与技能名（frontmatter `name`）的差异：官方仓库目录 `browser/` 的技能名是 `browser-automation`，本插件目录用技能名（便于对照发现结果）。其余目录名与技能名一致。

## 环境约束如何施加（**不改技能文件**）

官方技能是面向 Midscene 通用用户的：它们的「模型配置」节教 agent 去申请 Gemini／豆包等第三方 API key。而本插件的存在意义是让 Midscene 用 **DSH 已有模型**（桥托管本地 OpenAI 兼容端点、零第三方密钥）。

两者并存的做法是**在分发时注入环境说明，而不是改文件**：

- 磁盘上的技能文件保持与上游**逐字节一致**——可核对、升级时直接整目录覆盖，不存在「需要重新施加的补丁」；
- `src/host/skills.ts` 的 `loadBundledSkill()` 在返回内容前拼上 `BRIDGE_PRELUDE`（一段引用块），告知 agent：本环境用桥、配置是固定四行、**不要向用户索要模型 API key**，官方原文中的服务商与 key 示例仅作背景知识。

这样两个目标同时成立：技能内容与官方一致，且 agent 收到的内容带上了本环境的约束。**若把说明写进文件，就又是一份需要每次同步时重新施加的补丁。**

## 各文件 sha256（前 16 位）

用于确认本仓库这一份与上游一致（改动会被守卫测试发现）。

| 文件 | sha256 |
| --- | --- |
| `android-automation/SKILL.md` | `d083eb9877511287` |
| `browser-automation/SKILL.md` | `9aa7c602a7004e53` |
| `computer-automation/SKILL.md` | `3c9e4fd842b50375` |
| `harmony-automation/SKILL.md` | `80d91a1cad8ba0d2` |
| `ios-automation/SKILL.md` | `2c2014c57d2c28e5` |
| `midscenejs/GENERATION.md` | `da48a073de9830b9` |
| `midscenejs/SKILL.md` | `56a13ae404a4f2ca` |
| `midscenejs/references/faq.md` | `1b206b4c59d64c1a` |
| `midscenejs/references/integration.md` | `93a8f06abad2cd61` |
| `midscenejs/references/midscene-test/configuration.md` | `bfb91507bc2df728` |
| `midscenejs/references/midscene-test/extend.md` | `7331e7e72b583995` |
| `midscenejs/references/midscene-test/overview.md` | `0dcca0a6d0dea8e8` |
| `midscenejs/references/midscene-test/use.md` | `bc0442eee205ac26` |
| `midscenejs/references/model-config.md` | `045c7483ff72dbfb` |
| `midscenejs/references/overview.md` | `3bffc80b05bc0cb0` |
| `midscenejs/references/platforms.md` | `b80ee8e660448a13` |
| `midscenejs/references/skills.md` | `829f6e5307403e16` |
| `midscenejs/references/yaml-runner.md` | `20912c9fff92e223` |
| `vitest-midscene-e2e/SKILL.md` | `2a25ace7d193fac5` |
| `vitest-midscene-e2e/references/troubleshooting.md` | `5dc97fcc54c6b860` |
| `vitest-midscene-e2e/scripts/clone-boilerplate.sh` | `9b9220cea4d8e14d` |

## 同步方式（上游更新时）

**六个官方技能**

```bash
git clone --depth 1 https://github.com/web-infra-dev/midscene-skills.git /tmp/midscene-skills
git -C /tmp/midscene-skills log -1 --format=%H

# 官方目录名 → 本插件目录名（仅 browser 需要改）
#   browser → browser-automation，其余同名
cd plugins/dsh-midscene-plugin/skills
for n in android-automation computer-automation harmony-automation ios-automation vitest-midscene-e2e; do
  rm -rf "$n" && cp -R "/tmp/midscene-skills/skills/$n" .
done
rm -rf browser-automation && cp -R /tmp/midscene-skills/skills/browser browser-automation
# 无需再施加任何补丁——环境说明由 BRIDGE_PRELUDE 在分发时注入。
```

**`midscenejs`**

```bash
git clone --depth 1 git@github.com:tnnevol/skills.git /tmp/skills
rm -rf plugins/dsh-midscene-plugin/skills/midscenejs
cp -R /tmp/skills/skills/midscenejs plugins/dsh-midscene-plugin/skills/midscenejs
```

**两者共同**

```bash
# 重新计算本文件登记的 sha256（守卫测试会核对），并更新上游提交与同步日期
pnpm --filter @tnnevol/dsh-midscene test
```

## 与用户自装技能的关系

插件注册的技能在 DSH 技能发现优先级里排在项目目录与用户目录（`~/.agents/skills/` 等）之后，因此用户自行安装的同名技能天然胜出，插件不覆盖、不重复提示（需求 FNOS-013-13-AC-04）。

## 平台范围

6 个官方技能覆盖浏览器、桌面与三类移动平台，**全部内置**（与官方仓库一致）。其中移动端/桌面的 CLI 包（`@midscene/android`、`@midscene/ios`、`@midscene/harmony`、`@midscene/computer`）**不由本插件提供**——技能在执行时用 `npx -y @midscene/<平台>@1` 按需拉取，因此插件不必为不使用的平台背负依赖。
