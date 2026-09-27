---
feature: FNOS-007
acceptance: FNOS-007-01 至 FNOS-007-14
environment: macOS 开发机；Linux native 和真实 fnOS NAS 未在本记录中冒充通过
dshVersion: 0.1.7-rc.2
pluginVersion: '@tnnevol/dsh-codebuddy@0.1.7-rc.2; @tnnevol/dsh-codex-auth@0.1.7-rc.2; @tnnevol/dsh-fnos@0.1.7-rc.2; @tnnevol/dsh-semi-ui-showcase@0.1.7-rc.2'
verifiedAt: 2026-09-27
status: partial
---

# FNOS-007 本地自动化与 FPK 构建证据

## 已完成的本地证据

| 范围 | 结果 |
| --- | --- |
| DSH 基线、开发宿主边界、四插件兼容清单、FPK 清单和 native 输入 | `tooling/fnos-dsh-cli/tests/fnos-007-baseline.spec.ts` 通过，5 条；根开发宿主仍固定 `0.1.5-rc.2`，FPK catalog 为 `0.1.7-rc.2`。 |
| fnOS 插件 | typecheck；23 个测试文件 / 125 条通过。覆盖 SettingsForms、ConfigForms、settings tab、主题、授权目录、网关设置、图标和 `/fn` 引用。 |
| CodeBuddy | typecheck；67 个测试文件 / 881 条通过。覆盖 role tool、工具调用 ID/错误标记、推理重放、图片目标和工具结果图片。 |
| Codex Auth | typecheck；15 个测试文件 / 75 条通过。 |
| Semi UI 与 Showcase | 共享 UI 3 个测试文件 / 6 条通过；Showcase 2 个测试文件 / 39 条通过。 |
| Gateway 与安装辅助 | typecheck；15 个测试文件 / 58 条通过。覆盖嵌套 attachment-local 解析、0.1.7 补丁锚点、幂等、失败不写半成品、node-pty 生命周期、网关、WebSocket 和 DSH Web 生命周期。 |
| 构建 | 四个插件、共享 UI、Gateway 和 CLI build 通过；`pnpm run build -- --fpk --app fn-deepseek-harness --skip-bundle-dsh-native --bundle-dsh-plugins` 通过，FPK 内含四个 0.1.7 插件归档；`pnpm run build -- --docs` 通过。 |
| dshmarket | 发布清单、构建门禁和当前文档均固定 `1.65.1`；已安装版本的保留逻辑未改变。 |
| attachment-local | 安装回调从应用私有 DSH 依赖树递归解析嵌套包，校验包名和与 `DSH_VERSION` 对齐的精确版本，再对 `${TRIM_PKGVAR}` 应用原子、幂等补丁。 |

## 尚待真实环境执行

当前开发机没有已登录的 `trim-cli` NAS session；根据真机验证规范，不能代填 OAuth 或伪造设备证据。以下项目保持未验收状态：

- Linux runner 重新生成 `node-pty@1.2.0-beta.15` 的 `pty.node`/`spawn-helper`，并将 native bundle 放入正式 FPK。
- 无 g++ 且内置 native、有 g++ 且未内置 native 两条 NAS 安装路径。
- 新装、从 `0.1.5-rc.2` 升级、重复升级、安装失败恢复和回滚。
- 旧会话打开与日志导出、四个插件在真实 DSH Web 中保持启用、设置读写、附件读写、网关 HTTP/SSE/WebSocket 和 dshmarket 已安装版本保留。

完成上述项目后，应新增真实设备证据并把本记录状态改为 `passed`；在此之前 FNOS-007 不能宣称全部真实 NAS 验收完成。

## 执行命令

```text
pnpm run check -- --all
pnpm run build -- --docs
pnpm run build -- --fpk --app fn-deepseek-harness --skip-bundle-dsh-native --bundle-dsh-plugins
git diff --check
```
