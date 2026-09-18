# CLI 命令参考

非 Turbo 任务沿用相同的表达方式：根命令进入 `fn-apps-cli`，命令模块负责交互和参数分支，最后执行实际工具并汇总状态。

各命令的调度图见下。Turbo 相关任务的完整说明见 [Turbo 任务](./turbo-tasks)。

## `version`

版本维护分两个区域，交互选择后再进入具体分支。项目版本走 `bumpp`，插件版本直接更新 `package.json`。

```mermaid
flowchart TD
  command["pnpm run version"]
  cli["fn-apps-cli version"]
  area{"维护区域？"}
  project["项目 / FPK"]
  plugin["harness 插件"]
  pluginSelect["选择具体 harness 插件"]
  release["选择版本号与发布选项"]
  files["更新项目版本文件"]
  pluginFile["更新 harness 插件 package.json"]
  published["同步 published-dsh-plugins.json"]
  commit["git commit"]
  bumpp["bumpp：提交与创建 Tag"]
  status{"版本维护成功？"}
  result["是：返回成功"]
  fail["否：返回非零状态"]

  command --> cli --> area
  area -->|项目| project
  area -->|harness 插件| plugin
  project --> release --> files --> bumpp
  plugin --> pluginSelect --> release
  release --> pluginFile
  release --> published
  pluginFile --> commit
  published --> commit
  bumpp --> status
  status -->|是| result
  status -->|否| fail
```

项目/FPK 版本更新根 `package.json`、`docs/package.json`、`packages/**/package.json`、应用 `manifest` 和文档中的版本示例，默认创建提交和 `v<版本号>` Tag。插件版本只更新指定插件的 `package.json`，若插件在发布清单中则同步清单版本，默认只创建提交、不创建 Tag。

两者都不会自动 push。完整流程见[版本管理](../build/versioning)。

## `release:notes`

读取当前 Tag，判断是否为预发布，再交给 `changelogithub` 生成 Release 说明。

```mermaid
flowchart TD
  command["pnpm run release:notes"]
  cli["fn-apps-cli release:notes"]
  tag["读取 GITHUB_REF_NAME"]
  prerelease{"预发布 Tag？"}
  flag["补充 --prerelease"]
  changelog["执行 changelogithub"]
  github["创建或更新 GitHub Release"]
  status{"Release 成功？"}
  result["是：返回成功"]
  fail["否：返回非零状态"]

  command --> cli --> tag --> prerelease
  prerelease -->|是| flag
  prerelease -->|否| changelog
  flag --> changelog --> github --> status
  status -->|是| result
  status -->|否| fail
```

## `build:gateway`

仅供 CI 或网关构建使用，不经过交互层。

```mermaid
flowchart TD
  command["fn-apps-cli build:gateway"]
  cli["命令模块 action"]
  turbo["turbo run build:app --filter=@tnnevol/fnos-gateway"]
  gateway["执行 Gateway package.json 的 build:app"]
  status{"Gateway 构建成功？"}
  result["是：返回成功"]
  fail["否：返回非零状态"]

  command --> cli --> turbo --> gateway --> status
  status -->|是| result
  status -->|否| fail
```

构建 `fn-deepseek-harness` 的 FPK 时，CLI 会先调用这个入口产出网关 bundle，再执行 `fnpack build`。

## 相关页面

- [Turbo 任务](./turbo-tasks)
- [命令与脚本](./commands-and-scripts)
- [版本管理](../build/versioning)
- [发布流程](../build/release)
