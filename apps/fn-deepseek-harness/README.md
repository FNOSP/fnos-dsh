# DeepSeek Harness

`fn-deepseek-harness` 是 DeepSeek Harness 的 fnOS Native 应用，通过 fnOS 网关以 iframe 打开 Web UI。

- 架构：x86
- 运行时：`nodejs_v24`
- DSH：`0.2.0-rc.2`
- Web 入口：`/app/fn-deepseek-harness`

## 功能

- DSH Web 界面和 fnOS 文件入口
- CodeBuddy、Codex Auth、fnOS 和 Semi UI Showcase 插件集成
- CodeBuddy 成长任务、任务中心和执行日志
- NAS 目录授权、文件引用和会话日志导出
- 第三方插件 API 反向代理

## 安装与运行

安装回调会检查并准备固定版本的 DSH、pnpm 和插件。已满足版本时直接复用，不会删除用户的 profile、凭据、会话或工作区。

DSH 数据目录为 `${TRIM_PKGHOME}`，npm registry 配置保存在应用 `HOME/.npmrc`。npm 源由安装向导配置，失败时不会自动切换其他源。

应用使用 fnOS 包用户运行，不提供公开的 `dsh` 系统命令。管理员如需调用 CLI，请使用应用私有路径：

```bash
${DSH_HOME}/.npm-global/bin/dsh --help
```

常用命令：

```bash
dsh --profile web --dump-config
dsh plugin --profile web add <plugin>@<version>
dsh plugin --profile web update <plugin>@<version>
dsh plugin --profile web remove <plugin>
```

应用由 fnOS 网关管理，DSH Web 使用：

```bash
dsh web --no-open --host <host> --port <port> --trusted-host <authority...>
```

## node-pty 原生依赖

node-pty 由上游 `@deepseek-ai/dsh-subprocess-local` 引入，其 npm 包**自带各平台的预编译产物**。
fnOS 目标平台固定为 x86_64 Linux，因此统一使用 `prebuilds/linux-x64/pty.node`，不做运行时平台判断。
node-pty 的加载器按 `build/Release` → `build/Debug` → `prebuilds/<platform>-<arch>` 的顺序查找，因此：

- **构建与安装都不需要 g++**，FPK 也不再内置 node-pty 原生产物；
- 安装时由安装回调校验依赖树里 node-pty 的预编译目录是否存在，不复制、不编译；
- 安装流程使用向导写入 `.npmrc` 的 registry，不额外传 `--registry`。

```bash
pnpm run build -- --fpk --app fn-deepseek-harness --skip-bundle-dsh-plugins
```

依赖脚本仍然会执行（`npm rebuild`），以便 dsh 其余依赖的 install 脚本正常运行；node-pty
自身的 install 脚本在执行期间被临时替换，避免触发本地编译。

## 数据目录

| 内容 | 路径 |
| --- | --- |
| DSH 数据 | `${TRIM_PKGHOME}` |
| npm 全局目录 | `${DSH_HOME}/.npm-global` |
| npm 配置 | `${DSH_HOME}/.npmrc` |
| pnpm store | `${TRIM_APPDEST_VOL}/@appshare/fn-deepseek-harness/.local/share/pnpm/store` |
| 网关运行数据 | `${TRIM_PKGVAR}` |

## 构建

```bash
pnpm run build -- --fpk --app fn-deepseek-harness --skip-bundle-dsh-plugins
```

生成的 FPK 位于 `apps/fn-deepseek-harness/`。正式发布包由 GitHub Actions 构建；由于不再需要
编译原生依赖，macOS 与 Linux 均可直接构建。

## 卸载

卸载时可选择保留或删除应用数据。删除数据会清理 DSH、profile、凭据、会话和应用目录。
