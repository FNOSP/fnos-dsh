# fnOS Apps

飞牛 fnOS 应用 Monorepo，包含上架到 fnOS 应用商店的第三方应用打包。

## 项目结构

```
.
├── apps/
│   └── fn-deepseek-harness/        # DeepSeek Harness - 插件化智能代理(原生应用)
├── plugins/                        # Agent 插件 workspace
├── .github/workflows/              # CI: FPK 构建与 Release 发布
├── docs/                           # VitePress 项目文档
├── package.json                    # 项目版本与开发脚本
├── .gitignore
└── README.md
```

## 项目应用

| 应用                                                      | 显示名称         | 说明                                                                |
| --------------------------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| [fn-deepseek-harness](apps/fn-deepseek-harness/README.md) | DeepSeek Harness | DeepSeek AI 开源的插件化智能代理工具，通过 Web UI 提供 dsh 操作界面 |

## 测试与安装

### 项目文档

```bash
pnpm install
pnpm run start -- --docs
```

生产构建使用 `pnpm run build -- --docs`，构建结果位于 `docs/.vitepress/dist/`。

### 本地快速安装（开发阶段推荐）

```bash
# 在 fnOS 设备上，进入应用目录直接安装
cd /path/to/<appname>
appcenter-cli install-local
```

### 通过 fpk 文件安装

```bash
appcenter-cli install-fpk <appname>.fpk

# 带环境变量静默安装
appcenter-cli install-fpk <appname>.fpk --env config.env
```

### 手动安装模式（用于分发测试）

```bash
# 开启手动安装入口
appcenter-cli manual-install enable

# 关闭
appcenter-cli manual-install disable
```

### 查看日志

```bash
# 日志路径
cat /var/apps/<appname>/var/info.log

# 应用管理
appcenter-cli list
appcenter-cli start <appname>
appcenter-cli stop <appname>
```

## 版本发布

通过 GitHub Actions 自动完成 FPK 构建和 Release 发布。项目版本工具位于 `tooling/fn-os-apps-cli` workspace，通过 `fn-apps-cli` CLI 使用 `bumpp` 维护项目/FPK 版本；插件版本由 CLI 直接更新并提交。

### Tag 命名规范

```
v<版本号>
```

| Tag 示例     | 版本                |
| ------------ | ------------------- |
| `v4.0.0`     | 4.0.0               |
| `v4.1.0-rc1` | 4.1.0-rc1（预发布） |

### 发布步骤

1. **代码变更并推送**

```bash
git add apps/
git commit -m "feat: 更新多个应用"
git push origin main
```

2. **推送版本 Tag 触发发布**

```bash
pnpm run version -- project patch
git push origin main && git push origin v<版本号>
```

`version` 使用 `bumpp` 更新根 `package.json`、`packages/*/package.json`、与项目版本匹配的 `apps/*/manifest` 和 README 中的版本示例，然后创建项目提交和 `v<版本号>` Tag。插件版本不会被项目版本命令修改。

插件需要单独指定目标插件维护版本：

```bash
pnpm run version -- plugin fnos patch
pnpm run version -- plugin codex patch
pnpm run version -- plugin showcase patch
```

插件版本命令支持多选插件；多选时一次性修改所有选中插件，只生成一条合并提交，不创建 Git Tag。若插件出现在 `apps/fn-deepseek-harness/app/published-dsh-plugins.json`，其清单版本会与插件 `package.json` 同步更新。

3. **GitHub Actions 自动执行**

- **prepare-release** — 创建草稿 Release
- **build-dsh** — 构建 `fn-deepseek-harness` FPK，文件名格式 `fn-deepseek-harness-v4.0.0.fpk`
- **release** — 生成中文 Release 文案 → 发布 GitHub Release，附带 `.fpk` 包

单个应用也可以在自己的目录中执行 `./build` 构建。`fn-deepseek-harness` 的构建脚本默认自动递增 patch 版本。

## 上架应用

上架流程：

1. 加入飞牛粉丝群（[fnos.com](https://fnnas.com/) 二维码）→ 联系社区主理人加入 **应用中心开发者先锋交流群**
2. 提交基础信息完成认证（个人/企业信息、代表作品、技术栈等）
3. 获取官方文档 → 创建应用 → 提交审核 → 上架

> 开发者后台即将上线，在此之前通过群内专员协助完成内测和上架。

## manifest 字段参考

| 字段                         | 必填 | 说明                             | 示例                    |
| ---------------------------- | ---- | -------------------------------- | ----------------------- |
| `appname`                    | 是   | 应用唯一标识                     | `fn-deepseek-harness`   |
| `version`                    | 是   | 版本号，格式 `x[.y[.z]][-build]` | `3.2.14`                |
| `display_name`               | 是   | 显示名称                         | `DeepSeek Harness`      |
| `desc`                       | 是   | 应用描述（支持 HTML）            | 功能说明                |
| `platform`                   | 是   | 架构，`x86` / `arm` / `all`      | `x86`                   |
| `source`                     | 是   | 应用来源                         | `thirdparty`            |
| `maintainer`                 | -    | 原始维护者                       | GitHub ID               |
| `maintainer_url`             | -    | 原始项目地址                     | URL                     |
| `distributor`                | -    | 分发者                           | GitHub ID               |
| `distributor_url`            | -    | 分发者主页                       | URL                     |
| `service_port`               | -    | 服务端口                         | `4396`                  |
| `os_min_version`             | -    | 最低 fnOS 版本                   | `0.9.27`                |
| `desktop_uidir`              | -    | UI 目录名                        | `ui`                    |
| `desktop_applaunchname`      | -    | 桌面启动项                       | `<appname>.Application` |
| `disable_authorization_path` | -    | 禁用目录授权                     | `true`                  |

## 开发资源

- [飞牛开发者官网](https://developer.fnnas.com/)
- [fnpack 下载](https://developer.fnnas.com/docs/cli/fnpack/)
- [通用 CGI 网关集合](https://github.com/FNOSP/fnosAppCenterCgiCollection)
