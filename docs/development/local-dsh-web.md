# 本地 DSH Web

仓库根 `package.json` 声明了与 FPK 运行时基线相同的 `@deepseek-ai/dsh`。`pnpm install` 之后即可用仓库内的 CLI，不必依赖全局安装。

`start` 的「DSH Web」目标会以仓库根 `.dsh` 作为 `DSH_HOME` 启动本地实例，profile、凭据和会话都留在检出目录，与开发者的 `$HOME/.dsh` 互不影响。

## 启动

```bash
# 交互多选：Harness 插件 / 项目文档 / DSH Web
pnpm run start

# 直接启动本地 DSH Web（固定 8070 端口）
pnpm run start -- --web

# 需要手工检查仓库内 profile 时，自行指定同一个 DSH_HOME
DSH_HOME="$PWD/.dsh" pnpm exec dsh --profile web --dump-config
```

本地 DSH Web 固定使用 `8070`，与 FPK 网关占用的 `127.0.0.1:3080` 区分，两者可在同一台开发机同时运行。

## 与其他目标共存

三类目标可以任意组合：`start` 把「Harness 插件」「项目文档」和 DSH Web 一起交给**同一个 `turbo watch`**，各自作为一行任务显示在同一个 TUI 里。

DSH Web 因此是 Turbo 的根任务 `//#dev:web`，而不是 Turbo 之外另起的第二个前台进程——后者会占住终端，把 TUI 挤掉。

`//#dev:web` 需要两组特殊配置：

- `persistent: true`：常驻任务。
- `passThroughEnv: ["DSH_HOME"]`：Turbo 严格模式只把已声明的变量传给任务，未声明时 `DSH_HOME` 会被剥掉，本地 DSH Web 会退回用户主目录下的 `~/.dsh`。

## 文档服务与 TTY

文档服务的 `dev` 标记为 `interactive: true`，这样它的快捷键仍然可用：在 TUI 中按 `i` 把键盘交给该任务，按 `Ctrl+z` 交还给 Turbo；VitePress 自己的 `h`（帮助）和 `r`（重启）因此照常工作。

Turbo 不允许在没有终端界面的情况下运行 interactive 任务，所以 `start` 按是否有 TTY 决定文档服务的运行位置：

- **有 TTY**：进入 `turbo watch`，保留 TUI 与快捷键。
- **没有 TTY**（CI、管道、后台任务）：直接启动 `vitepress dev`，而不是让整条命令报 `Cannot run interactive task` 失败。

插件与文档共用 `dev` 任务名，因此文档只作为 `dev` 的 `--filter` 出现，**不写成显式的 `包#任务`**：显式任务名会把该包重新拉进范围，裸 `dev` 随即再匹配一次，VitePress 会被启动两遍。

## 插件内置进本地 profile

启动前，CLI 会把本仓库的插件链接进这个本地 profile，因此新克隆的检出目录第一次 `pnpm run start -- --web` 也能直接进入带插件的 DSH Web：

1. 先用 Turbo 构建待链接的插件。profile 通过包 `exports` 解析入口，而入口指向 git 忽略的 `lib/`；没有产物时 `dsh plugin add` 会链到一个无法加载的包。
2. 再用 `dsh plugin --profile web add <插件目录>` 逐个链接。由 DSH CLI 写入（而不是直接改 profile 清单）才会把插件同步进 `dsh.profile.bundles`，插件因此真正成为一层 patch layer。
3. 已链接且已在 bundle 列表中的插件会被跳过，重复启动不重复安装；链接后的插件产物变更由 `start` 的插件 watch 或重新构建生效。

内置范围是仓库里可在任意 DSH 客户端使用的插件。**`@tnnevol/dsh-fnos` 不在其中**：它注册 fnOS 设置命名空间、fnOS JS SDK 桥和网关前缀路由，脱离 fnOS 宿主没有可提供的能力，只会给本地 profile 增加加载失败的行。

## 状态目录

`.dsh/` 属于本地运行状态，已在 `.gitignore` 中排除，不要提交。

## 相关页面

- [命令与脚本](./commands-and-scripts)
- [插件开发](./plugin-development)
- [Turbo 任务](./turbo-tasks)
