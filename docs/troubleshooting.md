# 问题排查

## 文档站无法启动

确认 Node.js 和 pnpm 版本满足根 `package.json` 的要求，并重新安装依赖：

```bash
node --version
pnpm --version
pnpm install
pnpm run start -- --docs
```

## fnpack 找不到

```bash
command -v fnpack
fnpack --help
```

如果没有输出，请按照 [fnpack 打包](./build/fnpack) 安装并配置 `PATH`。

## 应用安装失败

先查看 fnOS 应用安装日志，再检查：

- `manifest` 中的依赖是否已安装。
- `cmd/install_callback` 是否返回非零状态。
- 安装向导字段是否缺失或格式不正确。
- 应用依赖的 npm、Python、镜像或中间件是否可访问。

## 应用无法启动

重点检查：

- `cmd/main` 使用的环境变量和目录是否存在。
- 服务监听端口是否被其他进程占用。
- 应用运行时版本是否与 `install_dep_apps` 一致。
- 应用日志中是否出现权限、路径或依赖加载错误。

### DSH Web 显示「DSH Web 未运行」且启动后立刻退出

恢复页只显示 `DSH Web exited with code 1`，真正的原因在启动日志里（`$DSH_HOME/logs/startup-*.log`
与 `/var/log/apps/fn-deepseek-harness.log`）。**最常见的是凭据文件权限被破坏**：

```text
Failed plugins (1):
  credentials
    Package: @deepseek-ai/dsh-credentials-local
    Error: EACCES: permission denied, open '$DSH_HOME/.credentials.yaml'
```

`credentials` 是关键单点：它初始化失败会让依赖它的插件（`connection`、`authorization`、
`deepseek-account`、`file-upload`、`dsh-codex-auth` 等）全部挂起，
DSH Web 因此直接退出。界面上只看到恢复页，没有任何指向权限的提示。

排查与修复：

```sh
# 1. 找出不可读的凭据文件（stat 显示 0 即异常，正常应为 600）
find "$DSH_HOME" -maxdepth 3 -type f -perm 000

# 2. 恢复为属主可读
chmod 600 "$DSH_HOME/.credentials.yaml"
chmod 600 "$DSH_HOME/.openai-codex-auth.json"    # 如存在
chmod 600 "$DSH_HOME/codebuddy-auth.json"        # 如存在（下架前装过 CodeBuddy 插件的机器）

# 3. 在 Web 端恢复页点「重启」，或重启应用
```

**为什么会变成 0**：fnOS 的共享文件夹（`/vol2/1000/...`）走 ACL，其传统权限位常显示为
`0000`；用 `cp -p` / `tar` 把凭据文件从那里搬回 `DSH_HOME`（btrfs）时，`0000` 会被原样保留。
手工备份/恢复凭据的完整约束见[测试用例文档规范](/charter/tests-spec#登录态与凭据文件)。

## iframe 页面资源异常

如果页面能打开但静态资源、API 或 EventSource 失败，检查 `app/ui/config`、统一网关前缀以及应用代理对以下路径的处理：

- `/api`
- `/plugins`
- `/plugins/events`

同时确认浏览器开发者工具中的响应类型与请求路径，避免将 API 或 SSE 请求错误返回为 HTML。

## 终端里没有 `DSH_HOME`

在 DSH 会话内新建的终端里执行 `echo $DSH_HOME` 得到空值；依赖该变量的命令（如
`dsh plugin`）因此找不到 profile。

**这是 DSH 上游的设计缺口，不是本应用的缺陷。**

传递链路的实际情况：

1. 网关用 `buildDshRuntimeEnv`（`packages/fnos-gateway/src/config/dsh-runtime-env.ts`）
   把 `DSH_HOME` 放进 DSH Web 进程的环境，这一步是**正常**的；
2. 终端的 PTY 环境只由官方 backend 的 `childEnvironment()` 决定
   （`@deepseek-ai/dsh-terminal-bash`），它返回 `TERM` / `PS1` / `DSH_SESSION_ID` 等
   少量覆盖，**不含 `DSH_HOME`**；
3. 基础环境来自 `childEnv()` → `scrubbedParentEnv()`
   （`@deepseek-ai/dsh-subprocess`），后者**剔除所有 `DSH_*` 前缀变量**：

   ```ts
   // packages/subprocess/subprocess/src/types.ts
   /** Namespace prefix reserved for DeepSeek Harness-managed child environment facts. */
   export const DSH_ENV_PREFIX = 'DSH_' as const
   ```

   `DSH_*` 是上游保留的命名空间，子进程不得继承，必须经 `DshEnvironment` 显式传入。
   而终端侧的 `childEnvironment()` 只显式传了两个 session id。

结论：变量在进入 DSH 后、创建终端时被上游过滤掉了。本应用无法通过配置修正——终端
backend 的 `Config` 没有 env 注入项，`startupSession()` 也只发送空内容，没有注入点。

**可选的修复方向**（暂未实施，待上游支持或按需再评估）：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| 替换终端 backend | 用插件在 profile 的 `cordis.patch.yml` 里禁掉官方 `optional-terminal-bash`，换成自己实现的 backend，构造环境时带上 `DSH_HOME` | 需实现并维护一个替代 backend |
| 写 shell rc | 启动前在 profile 目录写 `.bashrc` 之类，内容 `export DSH_HOME=...`，由 shell 自行加载 | 改动小，但依赖 shell 读取 rc，且只覆盖交互式 shell |

排查时可用 `dsh --version` 之外的方式确认当前实例的 home：Web 端「飞牛 OS 设置 →
运行」里显示的路径即为 `DSH_HOME`。
