# 随包分发的 Skill

本目录存放随 FPK 分发的 Agent Skill。安装回调把 `fnos-cli/` 复制到用户的
`~/.agents/skills/fnos-cli`——**仅当该目录尚不存在时**（用户自己装过就不覆盖）。

## fnos-cli

| 项目 | 内容 |
| --- | --- |
| 上游仓库 | <https://github.com/fnnas-labs/fnos-cli-skill> |
| 上游版本 | `0.6.1`（tag `skills-v0.6.1`） |
| 上游提交 | `d14b840eb0274cbbb07fa79d6536580932e7d9f1`（2026-10-29） |
| 同步日期 | 2026-10-30 |
| 许可 | MIT，见 `fnos-cli/LICENSE`；第三方声明见 `THIRD_PARTY_NOTICES-fnos-cli.txt` |

`fnos-cli/` 目录内容与上游 `skills/fnos-cli/` 保持一致，**不要在本仓库里改它**：
需要更新时整目录替换，并同步上面的版本与提交号。

该 Skill 自带启动器 `scripts/fnos-cli`（Windows 为 `.cmd`/`.ps1`）：首次执行时按
`runtime-manifest.json` 下载并校验对应版本的 CLI，缓存到用户系统缓存目录，
**不依赖全局 npm 安装，也不需要 Node**。因此随包分发只需要这个目录本身。

## 与 trim-cli Skill 的关系

早期版本内置的是 `@trimjs/trim-cli` 包里的 skill（安装到
`~/.agents/skills/trim-cli`）。现在改为内置本目录的 `fnos-cli`，但**不删除**用户
机器上已有的 `trim-cli` skill 目录，避免影响已经在用的 Agent 习惯。
