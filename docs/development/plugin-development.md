# 插件开发

`plugins/*` 中维护 DeepSeek Harness 的 harness 插件。插件开发前加载 [`$dsh`](https://github.com/tnnevol/skills/tree/main/skills/dsh) Skill，确认目标 DSH 版本、Profile、Host/Client 边界、Slot、Service 和 Bundle 约束。

```bash
# 安装或更新 Skill
pnpx skills add tnnevol/skills --skill dsh -g
```

## 实现边界

:::warning 插件实现边界

官方 Harness 源码只用于查阅和调试，**不直接修改**。插件的 `package.json`、Peer Dependency、兼容声明和 `@deepseek-ai/*` 依赖必须与目标 DSH 版本一致。

新增注册、定时器、网络连接或观察器时，必须提供可逆清理，并验证 HMR、重复注册和真实 Profile 加载。

:::

## 基础检查

```bash
# 仓库内 CLI，版本与 FPK 运行时基线一致
pnpm exec dsh --version

# 检查所有 harness 插件和共享包
pnpm run check -- --packages --plugins
```

需要查看组合配置时（下列命令使用全局 `dsh`；要检查仓库内 profile，请先按[本地 DSH Web](./local-dsh-web) 设置 `DSH_HOME`）：

```bash
dsh --profile web --dump-config
dsh --profile web --dump-config | grep -n -C 3 'dsh-fnos'
```

## 构建、启动和检查

```bash
# 交互选择 harness 插件、FPK 或文档
pnpm run build

# 构建指定 harness 插件
pnpm run build -- --plugin fnos

# 启动指定 harness 插件的 watch
pnpm run start -- --plugin fnos

# 检查所有 harness 插件和共享包
pnpm run check -- --packages --plugins
```

插件的 `build`、`typecheck`、`test` 和 `check` 写在各自的 `package.json`。Turbo 会根据 workspace 依赖先处理 `@tnnevol/dsh-semi-ui`，**不要在根脚本中手工复制依赖步骤**。

## 本地开发

插件的 `dev` 任务是常驻的 `tsdown --watch`，被 Turbo 通过 `start` 间接调度。它与共享包的关系有一条硬约束：

插件 bundle 需要解析 `@tnnevol/dsh-semi-ui/lib/index.js`。如果两边并行 `tsdown`，`dsh-semi-ui` 的 `clean`（默认删除 `lib/`）会让插件侧解析失败并报 `Could not resolve '@tnnevol/dsh-semi-ui'`。

因此共享包的 `dev` 是一次性构建（包内 `turbo.json` 覆盖 `persistent: false`），先完成；插件自己的 `dev` 保持常驻，并在 `interruptible: true` 下于依赖变化时被 `turbo watch` 重启。调度细节见 [Turbo 任务](./turbo-tasks)。

## 测试布局

插件的单元测试集中放在 workspace 同级 `tests/`，通过 `test` 调用该 workspace 的 `vitest.config.ts`。新增测试应放入对应 workspace 的 `tests/`，按被测模块组织文件；不要把跨 workspace 的测试复制到根目录，也不要把测试混入 `apps/` 下的 fnOS 应用目录。

## 相关页面

- [本地 DSH Web](./local-dsh-web)
- [Turbo 任务](./turbo-tasks)
- [路径与编码](./conventions)
- [Harness 插件总览](/plugins/)
