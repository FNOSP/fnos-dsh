# CI 构建

GitHub Actions 配置位于 `.github/workflows/build-release.yml`，由版本 Tag 触发；仓库当前只维护 `apps/fn-deepseek-harness` 一个 FPK 应用，构建由 `build-app.yml` 承担。

## 构建流程

1. `prepare-release` 创建或重置草稿 Release。
2. 下载并验证 `fnpack`。
3. 通过根 `build` 任务的 FPK 模式构建应用，**显式传两个平台**：`pnpm exec fnos-dsh-cli build --fpk --app fn-deepseek-harness --skip-bundle-dsh-plugins --platform x86 --platform arm`（node-pty 使用上游 npm 包自带的平台预编译产物，构建不需要编译器，也不内置原生产物）。
4. 逐平台核对产物 `fn-deepseek-harness-<平台>-<Tag>-dsh-<DSH 基线>/fn-deepseek-harness-<平台>-<Tag>-dsh-<DSH 基线>.fpk`：每个平台一个子目录，子目录名与包名同主干（平台段为 `x86` 或 `arm`，Tag 段为项目版本（如 `v7.1.0`），DSH 基线段在构建期从 `pnpm-workspace.yaml` catalog 派生，不在 workflow 中硬编码）。核对与上传两步的工作目录仍是 `apps/fn-deepseek-harness/dist`（FNOS-044 的产物目录），按 `${PACKAGE_NAME}/${PACKAGE_NAME}.fpk` 逐平台取包。任一平台的产物缺失都会让 `Verify versioned FPK artifacts` 步骤失败——不采用「取目录里第一个 `.fpk`」的写法，那种写法在两份平台包同时在目录里时只会处理其中一份，另一份既不核对也不上传，而步骤照样成功。
5. 逐个上传两份产物（各自重试 5 次，任一最终失败即整体失败），再由根 `release:notes` 任务调用 `changelogithub` 生成 GitHub Release。

CI 不做「发现 fnpack 固定名就顺手改名」的兜底：产物子目录里出现固定名只可能是构建的落成步骤没跑成，CI 静默补一刀会把发布链路上的真缺陷藏起来，宁可失败退出。

命名模板与本地构建侧（`tooling/fnos-dsh-cli/src/core/fpk-artifacts.ts` 的 `fpkReleaseFileName`）由 `tests/fpk-release-naming.spec.ts` 钉成同形：任一侧改了模板而另一侧没跟上，该用例即失败。

## 为什么是两份包而不是一份 `platform = all`

`fnpack` 没有平台参数：包内的平台声明完全来自被打包的那份 `manifest`。构建因此为每个平台准备一份临时副本、只改写副本里的 `platform` 行再打包，仓库那份 `manifest` 全程不被写入。实测两份产物除平台声明外内容一致（`app.tgz` 成员与内容相同，包内 `manifest` 只差 `platform` 一行）。

仓库 `manifest` 保持 `platform = x86`，不改成 `all`：发布方没有 ARM 设备，无法验证 ARM 装机结果。声明 `all` 会让全部既有用户在应用中心里看到「支持本机」并直接升级，一旦 ARM 侧有问题就是全量事故；双包方案下问题只影响主动选择 ARM 包的用户。ARM 包属**未经真机验证的社区自测产物**，issue #28 的回复与[应用上架规范](../charter/app-listing-spec)都按这个口径说明。

## 触发方式

```bash
pnpm run version -- patch
git push origin main
git push origin v<版本号>
```

推送 `v*` Tag 后，Actions 会自动开始构建。构建失败时，优先查看 `build-dsh` 任务的 `Build fn-deepseek-harness FPK` 步骤和 fnpack 输出。

## 新增应用检查

新增应用需要确保：

- `apps/<appname>/manifest` 存在且字段完整。
- 应用目录不依赖本地未提交文件。
- 生命周期脚本具有正确的执行权限。
- 所有构建依赖都能在 GitHub Actions 环境中获取。
- 在 `build-release.yml` 中接入新的构建任务；`build-app.yml` 只服务 `fn-deepseek-harness`。
