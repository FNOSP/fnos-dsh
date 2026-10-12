# 内置技能来源与本地改动

本目录下内置两个技能，来自两个不同的上游，**都在原文基础上做了最小补丁**：把「模型从哪来」改成 DSH 桥接服务提供的路径。

| 技能 | 上游 | 定位 |
| --- | --- | --- |
| `browser-automation` | [`web-infra-dev/midscene-skills`](https://github.com/web-infra-dev/midscene-skills) | **操作指令**：怎么用 CLI 跑浏览器自动化（三种连接模式、workflow、best practices） |
| `midscenejs` | [`tnnevol/skills`](https://github.com/tnnevol/skills)（`skills/midscenejs`） | **知识与 API 参考**：Midscene 是什么、模型与 FAMILY、五平台接入、Agent API、YAML 运行器、Midscene Test |

两者互补而非重复：前者告诉 agent「怎么执行」，后者回答「这是什么、API 怎么用、报错怎么办」。上游 `midscenejs` 的参考文档提炼自 Midscene 主仓库的中文文档源，因此它的版本节奏跟随 Midscene 发布（见其 `GENERATION.md`）。

## browser-automation

| 项目 | 内容 |
| --- | --- |
| 上游仓库 | https://github.com/web-infra-dev/midscene-skills |
| 上游路径 | `skills/browser/SKILL.md` |
| 上游提交 | `dec1d1c55252ecb1a90c4ecbcfd0d2cb3ce0ac7b`（2026-08-14） |
| 同步日期 | 2026-10-12 |
| 许可 | MIT（Copyright (c) 2024-present Bytedance, Inc. and its affiliates.） |
| 上游原文 sha256（前 16 位） | `9aa7c602a7004e53`——用于核对「同步到的原件是否正确」 |
| 本地副本 sha256（前 16 位） | `cba6ff70dc7d441c`——含下述本地改动，**不等于**上游原文 |

> 两个哈希都要记：上游原文哈希用于同步时确认拉到的原件版本，本地副本哈希用于确认本仓库这一份未被人手改动。只记一个会让人误以为「本地副本 = 上游原文」。

### 本地改动（相对上游原文）

改动**只涉及「模型来源」这一件事**，技能的操作指令（命令用法、三种连接模式、workflow、best practices）保持原文：

| 位置 | 上游原文 | 本地改动 | 原因 |
| --- | --- | --- | --- |
| `## Prerequisites` 整节 | 给出四个 `MIDSCENE_MODEL_*` 变量模板，并列 Gemini / Qwen / 豆包三个第三方服务商的完整示例（含各自的 API key 占位符），末尾写「若模型未配置，请让用户去设置」 | 替换为：**固定四行 `.env`**（基址、桥的接入密钥、固定模型名 `dsh-model`、协议家族）+ 三步走（探测健康检查 → 一条命令生成 `.env` → 校验模型有视觉能力）；明确「不要向用户索要模型 API key、不要配置第三方提供方」，并说明 `dsh-model` 由桥决定实际模型（跟随 DSH 会话模型，或用户在插件设置里指定的模型），以及换家族时怎么改 | **本插件的存在意义就是让 Midscene 用 DSH 已有的模型**。原文会让 agent 去要 Gemini/豆包 key，与产品定位直接冲突；固定四行使用户的 `.env` 不随模型变化而失效 |
| frontmatter `description` 末尾 | `Powered by Midscene.js (https://midscenejs.com)` | 追加一句：模型访问由 DSH Midscene Bridge 提供（本地、无需 API key），不要向用户索要 key 或配置第三方提供方 | description 是技能被发现时最先进入模型上下文的内容，改动指引必须在这里也可见，否则 agent 可能只读描述就去找 key |
| 文件尾部孤立片段 | 上游文件末尾有一段无标题、无上下文的豆包配置片段（`MIDSCENE_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/v3` 等四行） | 整段删除 | 该片段是第三方配置的残留，会被 agent 当作可用示例；既与桥接方案冲突，也是上游文件自身的瑕疵 |
| 排错章节新增 macOS 钥匙串小节 | 无（上游未涉及） | 新增：CDP 模式下系统钥匙串授权弹窗的原因（Chrome for Testing 为 adhoc 签名）与解法（`--use-mock-keychain` + 固定用户数据目录） | 这是 macOS 上复跑真实测试必然遇到的阻塞：无参数时 Cookie 库无法建立，等待授权会让存储不可用 |
| `### API Key Errors` 小节 | 「检查 `.env` 里的 `MIDSCENE_MODEL_API_KEY=<your-key>`；确认 key 对所选服务商有效」 | 重写为桥接场景的排错表：占位 key 说明、桥未运行的判断、`MISSING_CREDENTIAL`/`QUOTA` 的处理、family 不匹配的定位症状、无图片能力模型 | 原文的排错方向（换 key、验 key）在桥接场景下全是错的方向，会把用户引向「配一个第三方模型」 |

`MIDSCENE_MODEL_FAMILY` 的上游链接（`model-common-config`）保留在改动后的 Prerequisites 末尾，但降级为「背景参考」——家族取值本身仍需 Midscene 文档作为权威来源。

## midscenejs

| 项目 | 内容 |
| --- | --- |
| 上游仓库 | https://github.com/tnnevol/skills |
| 上游路径 | `skills/midscenejs/`（整目录，含 `SKILL.md`、`GENERATION.md` 与 `references/`） |
| 上游提交 | `b2616bbe0d587d4a5847ef7143d2da447ce9df02`（2026-10-12） |
| 上游技能版本 | `1.0.0`（其 `GENERATION.md` 记录） |
| 含参考文档 | 12 个文件（`SKILL.md` + `GENERATION.md` + 10 个 `references/*.md`，共约 1456 行） |
| 同步日期 | 2026-10-12 |
| 与 DSH 的关系 | 上游不含 DSH 内容（它面向 Midscene 通用用户），桥接改动全部由本插件施加 |

### 本地改动（相对上游原文）

改动**只涉及「模型从哪来」这一件事**，技能的其余内容（平台接入、Agent API、YAML 运行器、Midscene Test 等中文参考）保持原文：

| 文件 | 位置 | 上游原文 | 本地改动 |
| --- | --- | --- | --- |
| `SKILL.md` | frontmatter `description` | 只说明技能覆盖范围 | 追加：在 DSH 环境中模型访问由 DSH Midscene Bridge 提供（本地、无需 API key），**不要向用户索要模型 API key、不要引导配置第三方提供方**；技能里列出的第三方服务商仅作背景知识 |
| `SKILL.md` | `### 模型配置` 段首 | 直接列四件套与常见 FAMILY 取值 | 加引用块：DSH 环境用**固定四行**（基址为桥、密钥为桥的接入密钥、`MIDSCENE_MODEL_NAME="dsh-model"`、家族默认 `glm-v`），实际模型由桥决定 |
| `references/model-config.md` | 文件开头 | 直接进入「模型策略」 | 加引用块：DSH 环境下配置是固定四行、不需要任何第三方 API key，并给出生成命令；声明本页其余内容仅作背景知识 |
| `references/model-config.md` | `### 常见服务商 Base URL` | 无区分 | 标题标注「（背景知识）」并加框：DSH 环境下不要使用本表 |
| `references/model-config.md` | `### 配置示例` | 豆包四行 `export`（含 `your-api-key`） | 改为桥接方案（`curl` 一条命令生成 `.env`），并明确在 DSH 之外才需要自备第三方模型 |
| `references/model-config.md` | `## 设置环境变量（三选一）` | 三种来源的示例均为「替换为你的模型服务地址／API Key」 | 示例改为桥接四行，并补一步生成命令 |
| `references/skills.md` | `### 模型配置` | `your-api-key` 等四行占位 | 改为桥接方案与「不要向用户索要模型 API key」 |
| `references/yaml-runner.md` | `## 配置环境变量` | 「替换为你的模型服务地址」等四行 | 改为桥接方案的生成命令与四行说明 |

**判断标准始终是：技能不得引导 agent 去要模型 API key。** 未改动的部分（模型清单、FAMILY 取值表、协议说明、五平台包名与前置准备、Agent API、Midscene Test 用法）是 Midscene 的事实参考，与模型来源无关，保持原文以便随上游更新。

### 各文件本地副本 sha256（前 16 位）

用于确认本仓库这一份未被意外改动。上游原文的哈希不在此登记：上游技能是一整个目录（10 个参考文件），逐文件登记原文哈希的维护成本高于收益——**同步时以上游 commit 作为版本依据**。

| 文件 | 本地副本 sha256 |
| --- | --- |
| `GENERATION.md` | `da48a073de9830b9` |
| `SKILL.md` | `1118b1fc23d0a88a` |
| `references/faq.md` | `1b206b4c59d64c1a` |
| `references/integration.md` | `267234c17cc0b176` |
| `references/midscene-test/configuration.md` | `bfb91507bc2df728` |
| `references/midscene-test/extend.md` | `7331e7e72b583995` |
| `references/midscene-test/overview.md` | `0dcca0a6d0dea8e8` |
| `references/midscene-test/use.md` | `bc0442eee205ac26` |
| `references/model-config.md` | `4af9031d8ab62e6d` |
| `references/overview.md` | `3bffc80b05bc0cb0` |
| `references/platforms.md` | `b80ee8e660448a13` |
| `references/skills.md` | `9fda8ff875b53daf` |
| `references/yaml-runner.md` | `1a8a06cd4cc9e174` |

## 同步方式（上游更新时）

**两个技能都要检查**（上游不同，任一更新都要同步）：

```bash
# ── browser-automation（上游：midscene-skills）────────────────────────────
git clone --depth 1 https://github.com/web-infra-dev/midscene-skills.git /tmp/midscene-skills
git -C /tmp/midscene-skills log -1 --format=%H
shasum -a 256 /tmp/midscene-skills/skills/browser/SKILL.md

cp /tmp/midscene-skills/skills/browser/SKILL.md \
   plugins/dsh-midscene-plugin/skills/browser-automation/SKILL.md
# 重新施加三处改动：frontmatter 一句、Prerequisites 整节、Troubleshooting 一小节

# ── midscenejs（上游：tnnevol/skills）─────────────────────────────────────
git clone --depth 1 git@github.com:tnnevol/skills.git /tmp/skills
git -C /tmp/skills log -1 --format=%H

rm -rf plugins/dsh-midscene-plugin/skills/midscenejs
cp -R /tmp/skills/skills/midscenejs plugins/dsh-midscene-plugin/skills/midscenejs
# 重新施加改动：SKILL.md 的 description 与「模型配置」段、model-config.md 的开头／
# 服务商表／配置示例／设置环境变量、skills.md 的模型配置、yaml-runner.md 的配置环境变量

# ── 两者共同 ─────────────────────────────────────────────────────────────
# 重新计算本文件登记的 sha256（midscenejs 为逐文件），并更新上游提交与同步日期
pnpm --filter @tnnevol/dsh-midscene test   # 守卫会指名缺什么
```

**重新施加改动这一步不能省**：直接覆盖会把第三方 key 配置带回来。漏做不会静默通过——`tests/host/skills.spec.ts` 里有硬断言（技能必须含 `/v1/midscene-env` 与 `dsh-model`，且不得含 `your-google-api-key`、`dashscope.aliyuncs.com`、`ark.cn-beijing.volces.com` 等第三方配置字符串），跑测试即报红并指名缺什么。

**判断标准始终是：技能不得引导 agent 去要模型 API key。** 若某次上游重写了相关段落，按新结构重新组织改动，而不是照搬旧补丁的位置。

## 平台范围的说明

**`browser-automation`（操作技能）只内置 Web 场景。** 上游 `midscene-skills` 另有 `android-automation`、`ios-automation`、`harmony-automation`、`computer-automation`、`vitest-midscene-e2e` 五个技能，本插件**不内置**：需求「不在本次范围内」明确不承诺 YAML 运行器的非 Web 平台场景，只承诺 Web 场景；内置未承诺能力的操作技能会让用户以为可用。需要移动端/桌面自动化的用户可按上游仓库自装（`npx skills add web-infra-dev/midscene-skills`）。

**`midscenejs`（知识技能）保留其五平台参考内容**（`references/platforms.md` 等），因为它是**查阅性文档**而非可执行承诺：用户问「Android 怎么接」时给出准确答案，与「插件承诺支持 Android 自动化」是两件事。该技能不引导 agent 执行非 Web 平台操作。

## 与用户自装技能的关系

插件注册的技能在 dsh 技能发现优先级里排在项目目录与用户目录（`~/.agents/skills/` 等）之后，因此用户自行安装的同名技能天然胜出，插件不覆盖、不重复提示（需求 FNOS-013-13-AC-04）。用户自装的版本是上游原文，不含本插件的桥接改动——那种情况下模型来源由用户自己负责。
