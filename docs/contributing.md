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
