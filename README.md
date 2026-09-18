# fnos dsh

飞牛 DeepSeek Harness 应用生态项目。原[fn-os-apps](https://github.com/tnnevol/fn-os-apps)项目不在维护DeepSeek Harness应用。

## 项目架构

pnpm workspace 加 Turbo 的 monorepo。产物有两类，一个是 fnOS 应用包，另一个是能独立装进任意 DSH 客户端的插件（fnos 插件除外）。

```
apps/fn-deepseek-harness/   fnOS 应用包，manifest、生命周期脚本、向导、网关入口
packages/fnos-gateway/      网关代理，构建时输出到应用的 app/ 目录
packages/dsh-semi-ui/       共享的 Semi Design 组件，插件复用
plugins/                    DSH 插件，各自独立发版
tooling/fn-os-apps-cli/     仓库 CLI，统一 start / build / version / check
docs/                       VitePress 文档站
```

插件由 `plugins/*/package.json` 动态发现，加新插件不用改 CLI。应用要装哪些插件写在 `apps/fn-deepseek-harness/app/published-dsh-plugins.json` 里，安装时按精确版本装。

## 开发

需要 Node 24 和 pnpm 11。

```bash
pnpm install
```

日常开发用 `pnpm run start`，可以只起需要的部分。

```bash
pnpm run start -- --docs            # 文档站，http://localhost:9876
pnpm run start -- --plugin fnos     # 单个插件的 watch 构建
pnpm run start -- --web             # DSH Web，http://127.0.0.1:3150
```

不带参数会弹多选。`--web` 启动前会先把仓库里的插件链进本地 profile，所以第一次会慢一些。

构建分三类。

```bash
pnpm run build -- --plugin fnos                     # 构建插件
pnpm run build -- --docs                            # 构建文档
pnpm run build -- --fpk --app fn-deepseek-harness   # 构建 FPK
```

FPK 构建先编译网关再调 fnpack，产物在 `apps/fn-deepseek-harness/fn-deepseek-harness.fpk`。要不要把 node-pty native 文件和插件归档打进包里，用 `--bundle-dsh-native` 和 `--bundle-dsh-plugins` 控制，不给参数就交互询问。

改完代码跑一遍检查。

```bash
pnpm run check -- --all
```

### 版本更新

项目版本和插件版本分开走。项目版本由 `bumpp` 处理，会更新根 `package.json`、`packages/*/package.json`、`apps/*/manifest` 和文档里的版本示例，然后建一条提交加 `v<版本号>` tag。

```bash
pnpm run version -- project patch
```

插件版本只改目标插件的 `package.json`。如果这个插件在发布清单里，清单里的版本一起同步。

```bash
pnpm run version -- plugin fnos patch
```

两条命令都能加 `--no-commit --no-tag`，只改文件不提交。tag 推上去之后 GitHub Actions 会构建 FPK 并发布 Release。

### 项目文档

文档站是 VitePress，源文件在 `docs/`。

```bash
pnpm run start -- --docs     # 本地预览，带热更新
pnpm run build -- --docs     # 生产构建，输出到 docs/.vitepress/dist/
```

页面里有 D2 图，本地要看图得装 d2，没装的话图渲染不出来，其余内容正常。

## 开发资源

- [飞牛开发者官网](https://developer.fnnas.com/)
- [fnpack 下载](https://developer.fnnas.com/docs/cli/fnpack/)
- [通用 CGI 网关集合](https://github.com/FNOSP/fnosAppCenterCgiCollection)
