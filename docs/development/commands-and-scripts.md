# 命令与脚本

日常开发从根目录的 `pnpm run ...` 进入。根 `package.json` 是稳定入口，`tooling/fn-os-apps-cli` 中的 Commander 负责注册和分发命令。

## 先记住三件事

1. **根命令优先**：不要手写 `cd` 和任务编排，根脚本已经封装好。
2. **应用用 fnpack**：`apps/*` 没有统一的 Node.js workspace 任务，FPK 构建由 `fnpack` 完成。
3. **插件用 fn-apps-cli**：harness 插件的构建、检查和 watch 由 `fn-apps-cli` 调度，Turbo 负责依赖顺序和缓存。

## 命令地图

| 命令 | 用途 | 交互 |
| --- | --- | --- |
| `pnpm run start` | 启动 harness 插件 watch、文档服务和/或本地 DSH Web | 可选 |
| `pnpm run build` | 构建 harness 插件、FPK 应用和文档 | 可选 |
| `pnpm run check` | 检查 SDD、文档、共享包和 harness 插件 | 可选 |
| `pnpm run version` | 维护项目/FPK 或单个 harness 插件版本 | 可选 |
| `pnpm run publish` | 交互选择并发布 DSH 插件到 npm（`next` dist-tag） | 可选 |
| `pnpm run release:notes` | 使用 `changelogithub` 生成 Release 说明 | 否 |
| `pnpm run typecheck` | 通过 Turbo 执行所有包的类型检查 | 否 |
| `pnpm run test` | 通过 Turbo 执行单元测试 | 否 |
| `pnpm run docs:preview` | 预览已经构建好的 VitePress 站点 | 否 |

另有仅供 CI 或网关构建使用的入口：

```bash
pnpm exec fn-apps-cli build:gateway
```

各命令的分支与调度细节见 [Turbo 任务](./turbo-tasks) 和 [CLI 命令参考](./cli-commands)。

## 文档开发

文档由 VitePress 构建，流程图与时序图由 `vitepress-mermaid-plugin` 在浏览器端渲染，不需要安装额外系统工具。

```bash
# 启动文档开发服务（端口 8876）
pnpm run start -- --docs

# 构建文档
pnpm run build -- --docs

# 预览已经构建好的站点
pnpm run docs:preview
```

`start` 是开发服务的唯一根入口；CLI 通过 Turbo 的 `dev` 任务统一启动插件和 `docs` workspace 的 VitePress 服务。修改 `docs/` 下的 Markdown 后页面自动更新。

Mermaid 图使用 ` ```mermaid ` 代码块，渲染结果跟随明暗主题自动切换。注意 `graph` 是 Mermaid 保留字，不能用作节点 id。

## 提交前检查

按改动范围选择检查，提交前建议执行完整门禁：

```bash
# 文档或规格改动
git diff --check
pnpm run check -- --sdd
pnpm run build -- --docs

# 共享包或 harness 插件改动
pnpm run check -- --packages --plugins

# 完整门禁
pnpm run check -- --all
```

涉及 FPK、权限、Docker、网关或生命周期的改动，还必须在真实 fnOS 设备上完成安装、启动、停止、升级和卸载验证。

## 已废弃入口

:::danger 不要继续使用

- 根目录的 `pnpm run dev`：根脚本不再提供该入口，请使用 `pnpm run start`。
- 根目录自定义 `bump` 脚本：已废弃，请使用 `pnpm run version`。
- 历史的 `fnos-gateway build:fpk`：已移除，请用 `pnpm exec fn-apps-cli build:gateway` 构建 Gateway，再走 FPK 模式构建应用。

:::

需要注意：workspace 包中的 `dev` 任务**没有废弃**，它是 `turbo watch` 使用的内部任务。开发者通过 `start` 间接调用它，不要把它当成根目录命令。

## 相关页面

- [开发环境](./environment)
- [Turbo 任务](./turbo-tasks)
- [CLI 命令参考](./cli-commands)
- [贡献指南](/contributing)
