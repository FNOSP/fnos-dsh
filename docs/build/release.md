# 发布流程

## 发布新版本

在工作区干净且应用改动已完成后，使用根目录的 `fnos-dsh-cli` CLI 执行项目版本升级：

```bash
pnpm run version -- project patch
```

需要发布功能版本或大版本时，分别使用 `pnpm run version -- project minor` 或 `pnpm run version -- project major`。插件发布必须单独指定插件：

```bash
pnpm run version -- plugin fnos patch
```

脚本会创建类似下面的提交和 Tag：

```text
chore: release v5.0.7
v5.0.7
```

## 发布 npm 插件

当前 npm 发布仅支持 `next` dist-tag。CLI 会先询问要发布的插件，所有选择完成后再统一发布：

```bash
pnpm run publish
pnpm run publish -- --plugin fnos
```

该命令调用各插件的 `publish:next` 脚本，不会发布共享的 `dsh-semi-ui` 包。

### `latest` dist-tag 由发布命令自动维护（FNOS-012-04）

npm 的 `latest` 只在无 tag 发布时才会移动，而本仓库只发 `next`——不维护的话
`latest` 会长期停在历史版本，`npm i <包>` 默认装到旧版。发布命令在每个插件
`publish:next` 成功后按**代际规则**自动维护 `latest`，无需发布后手动设置：

- 版本形态固定为 `<上游版本>.<修订>`（如 `0.2.0-rc.2.0`），**代际** = 去掉最后
  一个修订段的前缀（`0.2.0-rc.2.0` 与 `0.2.0-rc.2.1` 同代际）。
- **新代际首版**发布时：`latest` 自动指向**上一代最新稳定版**（从 npm 已知版本
  解析），`pnpm run publish` 的输出会打印该变更，可审计。
- **同代际迭代版**：不动 `latest`，只更新 `next`。

发布输出出现 `latest: skip` 时说明当次未校正（离线、npm view 不可用或没有上一
代），此时按需手工校正。应急命令（`dist-tag set` 不是有效子命令）：

```bash
npm dist-tag add <包名>@<版本> latest   # 校正（幂等，可重复执行）
npm dist-tag ls <包名>                  # 查看全部 dist-tags
npm dist-tag rm <包名> <tag>            # 移除误加的 tag
```

备选方式：`pnpm publish --tag latest` 在发布那一刻直接指定；registry HTTP
`PUT /-/package/<pkg>/dist-tags`（body 为完整 dist-tags JSON，需 Bearer token）
适合脚本化批处理。

### 发布前复核产物（FNOS-012-05）

`keeps each compatibility package list aligned with source imports` 与
`keeps every documented install command on the released plugin version` 两条
用例只校验**仓库内**清单与安装命令，不校验已发布包的产物。因此：

- 发布前确认工作区干净：`git status` 无未提交改动，避免「源码已修、线上包未含」
  的时序漏网（FNOS-012-05 的真实缺口即由此产生——清单修正在发布后数十秒才提交）。
- 发布后若源码再改动产物相关文件（`compatibility.json`、`cordis.patch.yml`、
  `package.json`），必须随**下一次版本发布**进入线上包，不得让线上包与仓库源码
  长期不一致。
- 需要核对线上包内容时，下载已发布产物解包检查，不只看版本号：
  `npm pack <包名>@<版本>` 后解包读取 `compatibility.json`。

## 推送并触发构建

```bash
git push origin main
git push origin v<版本号>
```

构建完成后，在 GitHub Release 页面检查：

- 每个应用是否都有对应 `.fpk`。
- 文件名中的版本是否与 Tag 一致。
- Release 是否包含正确的提交记录。

## 提交应用上架申请

Release 发布成功并取得 FPK 后，按[应用上架规范](../charter/app-listing-spec.md)准备材料并提交飞牛上架申请。该规范给出表单字段口径、平台与上架类型的取值、官方 7 条自查规则在本项目的落点，以及提交前检查清单。

## 手动发布前检查

- 本地 `git diff --check` 通过。
- 目标应用可以通过 `fnpack build` 构建。
- 项目/FPK 版本命令涉及的 Manifest 与目标项目版本一致；独立维护版本的应用和插件不要求与根 `package.json` 相同。
- 应用 README、安装向导和文档没有遗留旧版本或旧路径。
- Manifest 的 `desc` 与 `changelog` 已随本轮功能完成及时更新：`desc` 富文本（HTML）内容与当前功能一致，`changelog` 概括本轮变更；发布前不再临时补写。
