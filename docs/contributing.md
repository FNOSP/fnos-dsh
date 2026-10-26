# 参与贡献

## Issue 提交规范

仓库启用了 issue 表单模板，入口分为三类：

| 入口 | 用途 |
| --- | --- |
| [Bug 报告](https://github.com/FNOSP/fnos-dsh/issues/new?template=bug_report.yml) | 应用、官方插件或文档的功能异常 |
| [功能请求](https://github.com/FNOSP/fnos-dsh/issues/new?template=feature_request.yml) | 新功能或改进建议 |
| [Discussions](https://github.com/FNOSP/fnos-dsh/discussions) | 使用咨询、配置问题与交流 |

空白 issue 已关闭，必须通过模板提交。第三方插件（如 `dsh-better-sidebar`）不在本仓库维护范围内，其问题请到对应插件仓库提交；模板配置中的 `contact_links` 会给出提示。

### Bug 报告要点

- 必填应用版本、DSH 版本和运行环境；fnOS NAS 环境补充 fnOS 版本。
- 必填日志或截图：fnOS 环境日志位于 `/var/log/apps/fn-deepseek-harness.log`，提交前删除 Token、密钥等敏感信息。
- 标题写"什么功能 + 什么异常"，正文按模板给出复现步骤、实际与期望行为。

### 功能请求要点

- 必填使用场景：描述想完成什么，而不是直接给实现方案。
- 需求编号（FNOS-XXX）为选填：普通用户留空即可，维护者在分诊阶段回填并关联 `docs/requirements/` 下的需求规格。

### Issue 与 SDD 的关系

issue 是变更入口之一，不直接等于需求规格。维护者确认有效后，按 [SDD 维护规范](/charter/sdd-workflow) 判断是否登记需求与计划，并在 issue 中回填需求编号；修复提交的 `fix` 类型 commit 在正文中关联 issue 编号（如 `Closes #4`），Pull Request 使用仓库自带的 PR 检查清单。

## 对外回复规范（Issue / PR / Discussions）

issue、Pull Request、Discussions 与 commit 都是**公开内容**，写上去就会被搜索引擎抓到，且无法真正撤回。回复前按下面的清单自查。

### 〇、用 `dsh-agent-bot` 身份回复

对外回复（issue、PR、Discussions 的评论与关闭说明、标签操作）统一由 **`dsh-agent-bot`** 账号发出，不以维护者个人账号出面。

- token 通过环境变量 **`DUTY_GITHUB_TOKEN`** 注入（`scripts/community-duty.mjs` 优先读取该变量，无需改代码）；未注入时才回落到 `GITHUB_TOKEN` / `GH_TOKEN` / `gh auth token`，那会以个人身份发言。
- 该账号在本仓库持有 **write** 权限，足以评论与关闭 issue、评论 discussion、打标签；它不具备 admin/maintain，涉及仓库设置的操作仍需维护者本人。
- **为什么分开**：读者能一眼分清「自动化值班的例行答复」与「维护者本人的承诺」；值班脚本误判时也不会被误读成维护者表态，事后纠正成本更低。
- 该账号自身的评论在值班扫描时视为**已处理**，不计入「待回复」水位线——否则脚本会回复自己的回复。

### 一、不写内网与个人信息

**禁止出现具体的内网地址、端口、设备名、账号与路径中的用户名**：

| 不要写 | 改写成 |
| --- | --- |
| `192.168.<x>.<y>:5666`、`10.0.<x>.<y>` | 真实 fnOS NAS（内网） |
| `<设备名>.fnos.net`、自定义 DDNS 域名 | 远程访问域名 |
| `/vol2/1000/xxx`（含用户名/UID 的路径） | 应用数据目录 |
| NAS 主机名、序列号、设备 ID | — |
| Token、Cookie、密钥、auth 文件内容 | 一律删除，不做脱敏替换 |

**可以写**的：应用版本、插件版本、DSH 运行时基线、fnOS 版本号、错误码、HTTP 状态码、日志片段（先脱敏）、以及必要的判定逻辑与请求结构（`ns`/`op`/`path` 这类字段名，不含值里的敏感信息）。

需要描述「在哪台设备上验证」时，写成**环境类别**而不是实例标识：

```text
设备：真实 fnOS NAS（fnOS 1.2.0800）
```

**为什么这么严**：内网地址一旦公开，等于告诉所有人「这个网段有这个服务」，配合默认端口与弱口令探测就是现成的攻击面；模型与端口还会暴露硬件与网络拓扑。仓库里已有历史文档包含这类信息，新增内容不再扩大范围；改动历史文档时顺手清理。

### 二、失败与未验证项要明说

- 没验成的项**单独列出**，不要把「没复现」写成「已修复」，也不要用「应该没问题」这类推断代替结论。
- 测到 0 或「被拒绝」时，说明**测量方法本身如何自证有效**（例如对照实验），否则读者无法判断这个 0 是真实结果还是没测到。
- 结论里区分「已验证」「未验证」「超出本次范围」，三者不混写。

### 三、给出可复核的判据

- 断言写**具体值**（版本号、状态码、字段内容），不写「显示正常」这类无法复核的描述。
- 涉及请求/响应时贴关键结构，不贴整段日志。
- 引用仓库内证据时给出文件路径与用例编号（如 `docs/tests/FNOS-015-theme-cache-write-loop.md` 的 TC-007），让读者能自己核对。

### 四、编辑既有的评论而非重复刷屏

- 补充信息、修正笔误时**编辑原评论**（GitHub 评论右上角 `Edit`），不要连发多条；一个 issue 内同一话题保留一条完整记录更易读。
- 关闭 issue 前，把结论、证据与未验证项**写进最后一条评论**，让后来者不用翻整个时间线。
- 修正已发出的公开内容时，同样用编辑——直接删除会丢失上下文，读者看到的状态与实际不符。

## 修改流程

1. **计划功能默认直接在 `main` 分支实施**，不创建执行专用分支或 worktree。开始前确认当前分支为 `main`，检查工作区状态，并避免覆盖与本计划无关的已有改动。
2. 按 [SDD 维护规范](/charter/sdd-workflow) 判断是否需要更新需求和计划；实现针对某个 issue 时在提交中关联它。
3. 修改对应应用、插件或文档。
4. 运行与改动相关的校验，包括 `pnpm run check -- --all`。
5. 使用 Conventional Commits 创建提交；直接在 `main` 实施的计划任务按仓库维护流程留存提交记录。
6. 只有用户明确要求采用分支协作或该改动需通过外部项目的 Pull Request 流程时，才切换到分支并提交 Pull Request；Pull Request 仍填写仓库 PR 检查清单。

## 提交规范

本仓库使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范，**提交信息使用中文描述**，由提交钩子自动校验格式：

```text
<type>(<scope>): <description>
```

### type

| 类型 | 用途 |
| --- | --- |
| `feat` | 新增功能或能力 |
| `fix` | 修复问题 |
| `docs` | 仅文档变更 |
| `refactor` | 重构，不改变外部行为 |
| `test` | 测试变更 |
| `build` | 构建、依赖或打包变更 |
| `ci` | CI/CD 配置变更 |
| `chore` | 其他维护性变更 |
| `perf` | 性能优化 |
| `revert` | 回滚提交 |

`scope` 建议使用受影响的应用名、插件名或模块名，例如 `fn-deepseek-harness`、`dsh-fnos`、`hooks`。**描述必须使用中文**，简明说明结果，不要以句号结尾。

```text
feat(fn-deepseek-harness): 新增可配置的存储设置
fix(fn-deepseek-harness): 限制不支持的监听地址
docs(contributing): 补充提交规范说明
chore(hooks): 更新 lint-staged 规则
```

复杂变更可以在标题后增加正文，正文同样使用中文；涉及不兼容变更时，在正文或页脚注明：

```text
BREAKING CHANGE: 应用配置字段名变更为 storage.config
```

### 提交前检查

项目通过 Lefthook 自动执行以下检查：

- `commit-msg`：使用 Commitlint 校验提交格式。
- `pre-commit`：使用 lint-staged 校验暂存的 JSON 和 Shell 文件。
- `pre-push`：执行 `pnpm run check -- --all`。

依赖安装后会自动安装 Git hooks。需要手动重新安装时执行：

```bash
pnpm exec lefthook install
```

## 应用修改检查

- Manifest 字段与应用目录保持一致。
- 生命周期脚本通过 `bash -n` 检查。
- JSON 配置可以被解析。
- 构建产物和 `.DS_Store` 不提交。
- 应用与插件的面向用户文档只更新 `docs/` 下的统一文档页面，不再同步维护 `docs/apps/`、`docs/plugins/`、`apps/<appname>/README.md` 或 `plugins/<pluginname>/README.md`。

## 文档修改检查

```bash
pnpm run check -- --sdd --docs
git diff --check
```

应用和插件说明应统一维护在文档站中。配置较多时优先增加现有文档章节，只有在内容确实独立且篇幅较大时才拆分页面。

## 编码约定

测试布局、类型定义策略和路径写法等仓库级编码约束统一维护在[路径与编码](/development/conventions)，提交前请确认改动符合其中的要求。

## 相关页面

- [路径与编码](/development/conventions)
- [SDD 维护规范](/charter/sdd-workflow)
- [命令与脚本](/development/commands-and-scripts)
