# fnpack 打包

`fnpack` 是飞牛应用打包工具，用于将应用目录构建为 `.fpk` 安装包。

## 安装

本项目本地开发使用 [fnpack 1.2.3](https://developer.fnnas.com/docs/cli/fnpack/)。请从官方页面下载适合开发机的版本，并将可执行文件放入 `PATH`。

```bash
# macOS Apple Silicon
chmod +x fnpack-1.2.3-darwin-arm64
sudo mv fnpack-1.2.3-darwin-arm64 /usr/local/bin/fnpack

# Linux x86
chmod +x fnpack-1.2.3-linux-amd64
sudo mv fnpack-1.2.3-linux-amd64 /usr/local/bin/fnpack
```

验证安装：

```bash
fnpack --help
```

## 构建单个应用

```bash
cd apps/<appname>
fnpack build
```

构建产物会生成在**执行命令时的工作目录**（不是 `--directory` 指定的目录），文件名恒为 `<appname>.fpk`。`.fpk` 文件默认被 Git 忽略，不应提交到仓库。

指定其他目录打包：

```bash
fnpack build --directory <path>
```

## 产物名与产物目录（FNOS-044）

`fnpack` **不能产出指定的文件名**：产物名由清单的 `appname` 决定，实测把源目录改名成目标文件名（如 `fn-deepseek-harness-x86-v9.9.9-dsh-0.0.0-test/`）再打包，产物仍是 `fn-deepseek-harness.fpk`；`build` 除 `--directory` 外没有其它可用参数。唯一能伪造文件名的办法是改写副本里的 `appname`——本仓库不这么做：`appname` 是 fnOS 识别已安装应用的身份，两份包给出不同 `appname` 会让 x86 与 ARM 被当成两个不同的应用。

因此构建侧保留一次「固定名 → 发布名」的落成，并把它收在产物目录内部：

| 位置 | 内容 |
| --- | --- |
| `apps/<appname>/dist/` | 本次构建的产物目录，每次构建先整体清空 |
| `apps/<appname>/dist/<appname>-<平台>-<Tag>-dsh-<基线>/` | 该平台的产物子目录，只放同名包 `<appname>-<平台>-<Tag>-dsh-<基线>.fpk` |
| `apps/<appname>/` | 构建输入（Manifest、生命周期脚本、`app/` 运行时内容），**不放产物** |

一个平台一个子目录，子目录名与包名同主干（即包名去掉 `.fpk`），所以从目录名就能看出里面那份包给哪类设备。`dist/` 每次构建**先整体清空再产出**，所以目录里的东西就等于「这一次产出了什么」；只选一个平台时，另一个平台的子目录一并消失，不会留着上一次的包。清空范围只有 `dist/` 本身，迁移前遗留在应用根目录的历史包不会被删。

打包输入复制到临时副本时按**相对应用目录**的路径排除 `tests/`、`node_modules/`、根下的 `dist/` 与 `*.fpk`：`dist` 只排应用根那一个，不排除任意深度——否则 `app/ui/dist/` 这类运行时内容会被静默丢掉。

## 平台（x86 / arm）与 `fnpack` 的关系

`fnpack` **没有**平台或架构参数。包内的平台声明完全来自被打包的那份 `manifest` 的 `platform` 字段，取值只有 `x86`、`arm`、`all`（官方 Manifest 文档「平台支持」；原 `arch` 字段已废弃）。

因此「为 ARM 打一份包」= 换掉那一行再打包。实测（2026-11-04）：把副本清单的 `platform` 改成 `arm` 后打包，包内清单与既有 x86 产物逐行比对**只有平台声明一行不同**，`app.tgz` 成员与内容一致。

本仓库不在应用目录里就地改清单，而是由构建流程准备临时副本、只改写副本的那一行，打完即删——仓库那份 `manifest` 是受版本管理的事实来源，就地改写一旦被中途打断会把脏值留下。完整设计见[FNOS-044 实施计划](/plans/PLAN-FNOS-044-fpk-platform-selection)与[CI 构建](./ci)。

`manifest` 的 `platform` 与产物名的平台段是**两件事**：前者是这一份包的属性，后者由构建按所选平台生成，所以 `pnpm run build -- --fpk` 一次可以在 `apps/<appname>/dist/` 下按平台各建一个子目录，产出两份平台声明不同、名字也不同（`<appname>-x86-…fpk`、`<appname>-arm-…fpk`）的包。

## 构建包装脚本

部分应用提供 `./build` 脚本，用于在调用 `fnpack build` 前完成版本递增、环境准备或构建失败后的回滚。使用前先阅读对应应用 README，确认脚本是否会修改版本号。

## 本地安装测试

在 fnOS 设备上进入应用目录执行：

```bash
appcenter-cli install-local
```

需要复现安装包行为时，使用：

```bash
appcenter-cli install-fpk <appname>.fpk
```
