---
title: 应用上架规范
description: fnOS DSH 从发布 Release 到提交飞牛应用上架申请的完整流程、表单字段口径与提交前自查规则。
---

# 应用上架规范

本规范把「发布 Release → 取得 FPK → 提交飞牛应用上架申请」这条链路固定下来：每次上架按本文执行，字段口径与自查项不再逐次重新确认。

## 与相邻文档的边界

| 主题 | 权威文档 |
| --- | --- |
| 版本命令、Tag 生成 | [版本管理](../build/versioning.md) |
| 推送 Tag、CI 构建、Release 产出与失败处理 | [发布流程](../build/release.md)、[CI 构建](../build/ci.md) |
| Manifest、`desc`/`changelog` 写法 | [Manifest 配置](../development/manifest.md) |
| 真实环境验收证据 | [验收证据规范](../validation/README.md) |
| **上架申请表单怎么填、提交前查什么** | **本文** |

上游表单自带 7 条自查规则，本规范不重复解释其含义，只说明本项目对每条规则的**落点**。

## 流程总览

整个链路分两段：前半段产出可安装的 FPK 与 Release，后半段把它提交上架。

```mermaid
flowchart LR
    A["功能完成"] --> B["真机验收"] --> C["版本升级"] --> D["推送 Tag"] --> E["CI 发布"] --> F["提交上架"]
```

CI 全程自动，**不需要手工创建或发布 Release**；需要人工介入的只有 Tag 推送前的准备、构建失败后的重建，以及最后的表单提交。

## 阶段一：发布 Release

### 前置条件

以下三项都完成后才进入发布，缺一项就发会在审核阶段暴露：

- `apps/fn-deepseek-harness/manifest` 的 `desc` 与 `changelog` 已随本轮功能更新（写法见 [Manifest 配置](../development/manifest.md)）；发布前不再临时补写。
- 涉及 NAS 的功能已在真实 fnOS 设备完成验收，证据记入 `docs/validation/`。本地通过不等于验收完成。
- 工作区干净，没有需要保留的未提交改动。

### 执行发布

```bash
pnpm run version -- project minor
git push origin main
git push origin v<版本号>
```

版本级别按变更性质选择 `patch`、`minor` 或 `major`；该命令统一更新根 `package.json`、文档包、`packages/*`、CLI workspace、应用 `manifest` 与 README 版本引用，并打 `v<版本号>` Tag。

### CI 自动流程

推送 `v*` Tag 触发 `build-release.yml`，三个 job 依次执行：

| Job | 作用 |
| --- | --- |
| `prepare-release` | 创建**草稿** Release；Tag 含 `-rc`/`-beta`/`-alpha` 时自动标记为预发布 |
| `build-dsh` | 构建 FPK 并上传到该草稿，产物重命名为 `fn-deepseek-harness-<Tag>-dsh-<DSH 基线>.fpk` |
| `publish-release` | 用 `changelogithub` 生成说明并发布 Release（`draft=false`） |

### 构建失败时

任一阶段失败时 `report-failure` 会把 Release 复位为草稿，并在 job summary 里给出各阶段状态。此时**不要重新打 Tag**，用 `workflow_dispatch` 传入原 Tag 重建：

```text
Actions → Build FPK & Release → Run workflow
release_tag: v<版本号>
```

重复推送同一个 Tag 只会让历史更乱；`workflow_dispatch` 就是为重建准备的入口。

## 阶段二：取得上架材料

发布成功后准备两项材料：

1. **FPK 文件** —— 从 Release 附件下载，文件名为 `fn-deepseek-harness-<Tag>-dsh-<DSH 基线>.fpk`。注意文件名里的 `dsh-` 段是 DSH 运行时基线，不是应用版本；应用版本以 Tag 为准。
2. **应用详情页截图** —— 在真实 fnOS 设备的应用中心打开应用详情页截图。该图仅用于审核，不会展示到应用中心，因此不需要刻意美化，但应能看清应用名称与版本。

截图属于一次性材料，不纳入版本管理；临时截图放在被忽略的 `.screenshots-tmp/`，不要提交到仓库。

## 阶段三：填写上架申请表单

表单地址：<https://trim-nas.feishu.cn/share/base/form/shrcn9ewk59TfoFWVAPMPy6aWSc>

表单的文本域是飞书 `contenteditable` 输入框，不是标准 `<input>`；用脚本填写时需走 `document.execCommand('insertText')` 之类的文本输入路径。

### 字段口径

带 `*` 为必填。本项目按下表填写：

| 字段 | 填写内容 |
| --- | --- |
| 应用名称* | `DeepSeek Harness`（与 `manifest` 的 `display_name` 一致，不得以「飞牛」为前缀） |
| 系统* | `fnOS` |
| 版本号* | `manifest` 的 `version`，须为三段式。**更新上架时必须先升版本号**，否则无法触发安装或升级链路 |
| 上架类型* | 首次提交选「新应用上架」，此前已上架选「应用更新」；仅换包不改版本选「应用包替换」 |
| 开发者* | 开源项目填原开发者信息：`DeepSeek AI` |
| 发布者* | 可接收审核反馈的群名称或联系方式（沿用历次提交的值，保持一致） |
| 微信昵称/联系方式* | 同上，用于审核进度沟通 |
| 应用详情页截图* | 阶段二准备的应用中心详情页截图 |
| 平台* | 按 `manifest` 的 `platform` 取值对应选择；当前只产出 x86 包，选 `x86`。产出双平台包后改选「x86和arm」 |
| fpk文件* | 阶段二下载的 FPK。x86 与 arm 是两个包时需同时上传两个 |
| 备注 | 首次上架说明应用用途；更新上架说明本次变更内容 |

### 提交前自查：本项目对 7 条官方规则的落点

| 官方规则 | 本项目落点 |
| --- | --- |
| 1. root 权限应用无法上架 | `config/privilege` 使用 `"run-as": "package"`，不使用 root |
| 2. 鉴权优先接入统一网关、不监听公网端口 | 走 fnOS 统一网关；服务固定监听 `127.0.0.1`，`manifest` 中 `checkport = false` |
| 3. `platform` 取值与提交前自测 | `platform = x86`；提交前已在真实设备验证可安装可运行 |
| 4. 文件读写接口需校验路径安全 | NAS 文件访问经授权目录集合校验，不使用用户传入的原始路径直接读写 |
| 5. 付费内容需在介绍首行声明 | 当前无付费内容，不适用 |
| 6. 版本号固定三段式 | `manifest` 的 `version` 为三段式；四位式无效 |
| 7. 应用名称不得以「飞牛」为前缀 | `display_name = DeepSeek Harness` |

提交前逐条核对上表。其中**规则 6 最容易踩**：fnOS 应用中心按版本号判断是否需要安装，版本与已装应用相同时会被当作同版本处理，走不到完整的安装或升级链路（详见[版本管理](../build/versioning.md)的「装机验证时临时提升 FPK 版本」）。因此上架前必须确认 `manifest` 的版本已提升。

## 阶段四：提交之后

通过审核后应用会自动推送到内测组；内测满一周后开放公测。需要跟进时通过表单里填写的发布者联系方式与官方沟通。

## 提交前检查清单

- [ ] `manifest` 的 `version` 已升版本号且为三段式。
- [ ] `manifest` 的 `desc` 与 `changelog` 反映本轮变更。
- [ ] 涉及 NAS 的功能已有真实设备验收证据。
- [ ] Tag 已推送，Release 状态为已发布（非草稿）。
- [ ] FPK 文件名中的 Tag 与本次上架版本一致。
- [ ] 应用详情页截图已准备。
- [ ] 上架类型、平台与本次提交实际情况一致。
- [ ] 表单字段按上文口径填写，7 条自查规则逐条核对无阻塞项。

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-09 | 首次编写：固化发布到上架的完整流程、表单字段口径与自查规则落点。 |

## 相关页面

- [发布流程](../build/release.md)
- [版本管理](../build/versioning.md)
- [CI 构建](../build/ci.md)
- [Manifest 配置](../development/manifest.md)
- [SDD 维护规范](./sdd-workflow.md)
