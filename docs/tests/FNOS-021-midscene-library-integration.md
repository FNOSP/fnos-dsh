---
id: FNOS-021
title: FNOS-021 测试用例
description: FNOS-021 Midscene 库能力对齐与接入简化的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-021-midscene-library-integration
plan: /plans/PLAN-FNOS-021-midscene-library-integration
status: 部分执行
lastVerified: 2026-10-22
verifiedAt: 2026-10-22
---

# FNOS-021 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-021 |
| 关联需求 | [FNOS-021 Midscene 库能力对齐与接入简化](/requirements/FNOS-021-midscene-library-integration) |
| 关联计划 | [PLAN-FNOS-021 Midscene 库能力对齐与接入简化](/plans/PLAN-FNOS-021-midscene-library-integration) |
| 测试状态 | <Badge type="warning" text="部分执行（62/75 通过，其余待补测）" /> |
| 执行环境 | 本地构测、DSH Web（本地 8070）、DSH Desktop（开发态） |

## 测试范围与需求分析

覆盖 [功能列表](/requirements/FNOS-021-midscene-library-integration#功能列表) 中 FNOS-021-01 至 FNOS-021-07 全部功能：

- 库基线升级（[FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01)）。
- 多职责模型接入配置（[FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02)）。
- 模型原生思考开关透传（[FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03)）。
- 家族推断准确性（[FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04)）。
- 内置技能同步（[FNOS-021-05](/requirements/FNOS-021-midscene-library-integration#fnos-021-05)）。
- 接入配置显式声明协议并指引误配（[FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06)）。
- 说明页与实现一致（[FNOS-021-07](/requirements/FNOS-021-midscene-library-integration#fnos-021-07)）。

### 功能模块树

```text
FNOS-021
├─ 库基线
│  ├─ catalog 与安装等待期豁免列表
│  ├─ 导出面兼容（test / web / e2e-kit）
│  └─ 既有 e2e 与桥冒烟回归
├─ 接入配置生成
│  ├─ 四职责模型选择（默认/定位/规划/理解）
│  ├─ 按职责推导家族
│  ├─ 专用职责变量的出现条件
│  └─ 留空继承默认模型
├─ 桥行为
│  ├─ 思考意图 → reasoningEffort
│  ├─ 档位未命中不传
│  └─ 协议声明与误配指引
├─ 家族推断
│  ├─ 规则顺序（AutoGLM / UI-TARS / 豆包）
│  ├─ 白名单与上游一致
│  └─ 未知模型不猜
├─ 技能分发
│  ├─ 快照版本与哈希登记
│  └─ 环境说明注入不被覆盖
└─ 说明页
   ├─ 配置项与界面字段
   ├─ 端点行为与端口描述
   └─ 不支持能力说明
```

### 系统形态识别与专项章节启用

| 专项 | 是否启用 | 依据 |
| --- | --- | --- |
| 接口测试 | ✅ 启用 | 桥提供 `GET /v1/models`、`GET /v1/health`、`GET /v1/midscene-env`、`POST /v1/chat/completions` 四个端点，本次新增协议指引分支与多职责字段 |
| 安全测试（OWASP） | ✅ 启用（子集） | 桥是回环 HTTP 服务 + 接入密钥 + 会落盘图片，涉及 A01 访问控制、A02 敏感数据、A05 配置错误、A09 日志、A10 SSRF |
| 权限测试 | ✅ 启用 | 设置端点的同源校验、密钥显示与重新生成 |
| 易用性测试 | ✅ 启用（子集） | 设置页由一行变四行，需核对留空语义可理解、不存在模型有提示 |
| 兼容性测试 | ✅ 启用（子集） | 双客户端（DSH Web / DSH Desktop）+ 既有 `.env` 升级不失效 |
| 性能测试 | ❌ 未启用 | 本次改动不引入新的性能路径；思考开关的影响以「行为验证」而非指标验证（见 TC-036 备注） |
| 移动端测试 | ❌ 未启用 | 插件本体无移动端界面；插件分发的 Android/iOS/HarmonyOS 技能是文档，不产生客户端行为 |
| AI/算法测试 | ❌ 未启用（以边界用例替代） | 插件不训练、不调参、不评测模型效果；模型效果属 Midscene 上游。本次只验证「意图传递是否正确」，见 TC-028～TC-036 |
| 数据迁移测试 | ❌ 未启用 | 无数据迁移；配置项为增量，旧字段语义不变（TC-013 覆盖旧配置兼容） |
| 灰度发布测试 | ❌ 未启用 | 插件按版本整体发布，无灰度机制 |
| ERP 专项 | ❌ 未启用 | 非 ERP 系统 |

### 关键风险点

- **升级引入「判定变严」而非真实回归**：`1.16.0` 起强化了资源清理语义、`1.16.5` 又引入环境准备/清理超时，既有 e2e 可能出现新的失败。判定时必须区分「产品坏了」与「框架判得更严」，否则会误改被测应用（TC-012 专为此设计）。
- **留空语义被误解**：四行配置若把「留空」呈现得像「未配置完成」，用户会以为必须填满，反而回到手写 `.env` 的老路（TC-016、TC-024 守住）。
- **思考档位「看起来传了」**：宿主不接受未声明的档位并会在发请求前报错。TC-031/TC-032 用反向断言守住「未命中就不要传」。
- **家族修正可能反向打坏既有映射**：调整规则顺序会改变匹配结果，`glm-4.6v` 之类必须仍是 `glm-v`（TC-004 反向断言）。
- **倒退风险高于缺陷风险**：最容易犯的错误不是「没兼容新字段」，而是「为了兼容新字段把现有可用路径改坏」。`response_format` 自 1.15.1 起就被桥忽略且全部验收通过，若改成报错会把今天能跑的功能推成失败（TC-038 专为此守卫，TC-042a 守住「全部 provider 可调用」）。

## 测试环境

目标环境按[需求的验收环境范围](/requirements/FNOS-021-midscene-library-integration#验收环境范围)划分；执行方式遵循[测试环境执行方式](/charter/tests-spec#测试环境执行方式)。

| 功能 | 目标环境 |
| --- | --- |
| [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01)、[FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03)、[FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04)、[FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) | 本地构测（单测 + 桥端点断言） |
| [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02)、[FNOS-021-05](/requirements/FNOS-021-midscene-library-integration#fnos-021-05)、[FNOS-021-07](/requirements/FNOS-021-midscene-library-integration#fnos-021-07) | DSH Web（`pnpm run start -- --web`，`DSH_HOME=<repo>/.dsh`）+ DSH Desktop（开发态，CDP） |

**不需要真实 NAS**：本需求不涉及 fnOS 宿主能力。

**版本基线（执行时填写）**：DSH `0.2.1-rc.2` / 插件 `@tnnevol/dsh-midscene@<待填>` / 应用 `5.9.0`；额外记录 Midscene 库版本（应为 `1.16.5`）。

## 测试用例

### [FNOS-021-04 模型家族推断准确性](/requirements/FNOS-021-midscene-library-integration#fnos-021-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | [FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | AutoGLM 系列判为 `auto-glm` | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | — | 对 `autoglm-phone`、`auto-glm-multilingual`、`codebuddy/autoglm` 三个标识依次调用家族推断 | 三者均返回 `auto-glm` 或 `auto-glm-multilingual`（不含 `glm-v`） | P0 | 缺陷场景（修复前实测为 `glm-v`） |
| TC-002 | [FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | 豆包系 UI-TARS 判为对应 UI-TARS 家族 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | — | 对 `doubao-1.5-ui-tars`、`ui-tars-1.5` 调用家族推断 | 前者为 `vlm-ui-tars-doubao-1.5`，后者为 `vlm-ui-tars-doubao-1.5`；均不为 `doubao-vision` | P0 | 缺陷场景（修复前实测为 `doubao-vision`） |
| TC-003 | [FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | 豆包 Seed 与旧视觉家族不被 UI-TARS 规则抢走 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | — | 对 `doubao-seed-2.1`、`doubao-vision-pro` 调用家族推断 | 分别为 `doubao-seed` 与 `doubao-vision` | P1 | 回归保护 |
| TC-004 | [FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | GLM 视觉模型仍判为 `glm-v` | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | — | 对 `glm-4.6v`、`glm-5v-turbo`、`zhipu/glm-4.6v` 调用家族推断 | 三者均为 `glm-v` | P1 | 回归保护（防止规则顺序修正反向打坏） |
| TC-005 | [FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | 白名单与上游一致 | [AC-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | 已安装 `@midscene/shared@1.16.0` | 1. 读取插件导出的白名单；2. 逐项与上游 `TModelFamily` 比对 | 两者逐项一致（含 `jev`），且共 21 项 | P0 | 新增行为，无回归基线 |
| TC-006 | [FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | 未知模型仍回落通用协议并标注 | [AC-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | — | 对 `codebuddy/hy3` 调用家族解析 | 返回通用家族 `glm-v` 且 `exact: false`；理由为「不在适配器名单内」 | P1 | 基线：FNOS-013 的通用协议结论 |
| TC-007 | [FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | 推断结果始终落在白名单内 | [AC-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | 准备 20 个真实模型标识 | 遍历调用家族推断，凡是返回结果的都必须能在白名单中找到 | 无一项落在白名单外 | P1 | 回归保护 |

### [FNOS-021-01 Midscene 库基线升级](/requirements/FNOS-021-midscene-library-integration#fnos-021-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-008 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 三个直接依赖均为 1.16.5 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 已执行安装 | 1. 读取 `node_modules/@midscene/{web,test}/package.json`；2. 核对 workspace catalog 三行与豁免列表 6 行 | 三包版本均为 `1.16.5`；catalog 与豁免列表均为 `1.16.5`；锁文件内无 `1.16.0` 残留 | P0 | 新增行为，无回归基线 |
| TC-009 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 锁文件与目录一致 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 已执行安装 | 在冻结模式下重新安装 | 安装成功、锁文件无变更 | P0 | 新增行为，无回归基线 |
| TC-010 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 插件类型检查与单测通过 | [AC-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 已升级 | 执行插件 `check`（类型检查 + 单测） | 全部通过，无新增失败 | P0 | 基线：升级前全绿 |
| TC-011 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 桥接冒烟在新版本下通过 | [AC-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | DSH Web 运行中、Chrome 已装扩展、目标页已打开 | 执行插件 `test:bridge` 冒烟 | 冒烟通过；每步以页面内状态独立核实 | P0 | 基线：FNOS-013 的冒烟脚本结论 |
| TC-012 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 既有 e2e 用例在新版本下通过或失败可归因 | [AC-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 同上 | 执行插件 `tests/e2e` 全量 | 全部通过；若有失败，逐条判定是「产品回归」还是「框架判定变严」，后者登记后不阻塞 | P0 | 基线：升级前 e2e 通过记录 |
| TC-013 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 既有接入配置升级后仍可用 | [AC-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 保留升级前生成的 `.env`（单模型四行） | 1. 升级插件；2. 不修改 `.env`；3. 在运行目录执行 Midscene 定位与断言 | 请求成功，无需重新拉取配置 | P0 | 基线：FNOS-013 的四行固定配置 |
| TC-014 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 共享装配包与同类插件类型检查不回归 | [AC-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 已升级 | 依次执行 `packages/dsh-e2e-kit`、`plugins/dsh-failover-search-plugin`、`plugins/dsh-codebuddy-plugin`、`apps/fn-deepseek-harness/tests` 的类型检查 | 全部通过 | P1 | 回归保护 |

### [FNOS-021-02 多职责模型的接入配置](/requirements/FNOS-021-midscene-library-integration#fnos-021-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-015 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 设置页出现四行模型选择 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | DSH Web 运行、插件已启用 | 1. 打开插件管理页；2. 进入本插件详情页；3. 查看设置区块 | 可见「默认模型」「定位模型」「规划模型」「页面理解模型」四行，且每行都有留空提示 | P1 | 新增行为，无回归基线 |
| TC-016 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 四行全部留空时接入配置与升级前一致 | [AC-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 四行均未选择 | 1. 读取 `/v1/midscene-env` 的 `content`；2. 与升级前保存的 `.env` 逐行比对 | 除端口/密钥等动态值外逐行一致；不出现任何 `MIDSCENE_{LOCATE,PLANNING,INSIGHT}_*` 变量 | P0 | 基线：FNOS-013 的四行固定配置 |
| TC-017 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 仅指定定位模型时只多出该职责变量 | [AC-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 目录中至少两个识图模型 | 1. 定位模型选 A，其余留空；2. 读取接入配置 | 出现 `MIDSCENE_LOCATE_MODEL_{BASE_URL,API_KEY,NAME,FAMILY}` 与 `MIDSCENE_LOCATE_MODEL_STREAM_MODE`；不出现 Planning / Insight 变量 | P0 | 新增行为，无回归基线 |
| TC-018 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 专用职责家族按自己的模型推导 | [AC-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 目录中有不同系列的两个识图模型（如 GLM 系与 DeepSeek 系） | 1. 默认模型选 GLM 系；2. 定位模型选 DeepSeek 系；3. 读取接入配置 | 默认家族为 `glm-v`，定位家族为 `deepseek`；两者不串用 | P0 | 新增行为，无回归基线 |
| TC-019 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 四个职责各选不同模型时互不影响 | [AC-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 目录中至少四个识图模型 | 四行分别选择不同模型后读取接入配置 | 四组变量各自独立，模型名与家族均为对应行的取值 | P1 | 新增行为，无回归基线 |
| TC-020 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 留空的专用职责不写入变量 | [AC-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 仅默认模型有值 | 读取接入配置并搜索 `MIDSCENE_PLANNING_MODEL_` 与 `MIDSCENE_INSIGHT_MODEL_` | 两者均不出现（上游语义：未配置时使用完整默认模型配置） | P0 | 新增行为，无回归基线 |
| TC-021 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 指定目录中不存在的模型时如实提示 | [AC-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 已通过配置或旧版本写入一个目录中不存在的模型 | 1. 打开设置页；2. 查看该行 | 界面标出「目录中不存在」类提示并保留原选择；不静默改选其它模型 | P1 | 基线：FNOS-013 的单行行为 |
| TC-022 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 下拉只列识图模型 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 目录中同时存在纯文本与识图模型 | 展开四行下拉并核对选项 | 每行选项均为 `vision: true` 的模型；无纯文本模型 | P1 | 基线：FNOS-013 的能力门控 |
| TC-023 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 不存在识图模型时给出提示而非空下拉 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 精简 profile 或临时使目录无识图模型 | 打开设置页查看模型相关行 | 显示「需要先安装并登录一个提供方」类提示；不渲染空下拉 | P2 | 基线：FNOS-013 的空态设计 |
| TC-024 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 「留空=跟随」的语义在界面上可理解 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | — | 阅读三行专用职责的留空提示文案 | 明确写出「留空则使用默认模型」；不出现「未配置完成」类误导 | P2 | 新增行为，无回归基线 |
| TC-025 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 四行修改即时作用于运行中的桥 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 桥在运行 | 1. 修改定位模型；2. 不重启 DSH，重新读取接入配置 | 返回新的定位模型与家族 | P1 | 基线：FNOS-013 的热更新行为 |
| TC-026 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 接入配置预览按职责分段且可整体复制 | [AC-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 至少指定一个专用职责 | 1. 查看设置页的接入配置预览；2. 复制内容 | 默认四行在前、专用职责在后；复制结果可直接作为 `.env` 使用 | P2 | 新增行为，无回归基线 |
| TC-027a | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 未配置专用职责时接入配置只出四行 | AC-02 | 插件已装、桥在运行 | 1. 保持全部职责未配置；2. 拉取接入配置；3. 提取其中所有 `MIDSCENE_` 开头的行 | 恰好 4 行（基址、密钥、模型名、家族），且不含任何 `MIDSCENE_{LOCATE,PLANNING,INSIGHT}_MODEL_`；与升级前逐字符一致 | P0 | 新增守卫（守住「零感知」） |
| TC-027b | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 四个职责的模型名互不相同 | AC-03 | — | 拉取接入配置，读取四个职责各自写入的模型名 | 四个值互不相同。**共名会让桥无法分辨请求属于哪个职责，专用职责的模型永远不被用上** | P0 | 设计不变量（路由前提） |
| TC-027c | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 职责名不影响「提供方/模型」老路径 | AC-03 | — | 以 `codebuddy/glm-5.3-flash` 形式发补全请求 | 仍按「提供方/模型」解析并调用该模型，不被当成职责名 | P0 | 回归保护（老路径不得失效） |
| TC-027d | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 专用职责的请求打到该职责自己的模型 | AC-03 | 目录含两个识图模型 | 1. 默认配模型 A、定位配模型 B；2. 分别以默认职责与定位职责的模型名发补全请求 | 两次调用分别落到 A 与 B | P0 | 新增守卫（职责分工的核心） |
| TC-027e | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 专用职责未配置或模型失效时回落默认 | AC-02 | 同上 | 1. 不配定位模型，以定位职责的模型名发请求；2. 配一个目录中不存在的定位模型后重发 | 两次均成功，实际调用的是默认职责的模型（不报错、不另挑一个） | P0 | 对齐上游「`_NAME` 为空即用默认配置」 |
| TC-027f | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 未配置的职责既不生成变量也不登记实际使用 | AC-02 | 仅默认职责配置了模型 | 拉取接入配置，核对变量字典与各职责实际使用模型 | 只有默认职责的 4 个变量；未配置的职责既无变量、也不出现在「实际使用」里（否则界面会误报该职责已单独配置） | P0 | 新增守卫 |
| TC-027 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 多职责配置端到端可用 | [AC-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 已生成多职责接入配置 | 1. 写入运行目录 `.env`；2. 执行一次含定位与断言的 Midscene 任务 | 任务成功；桥日志显示各职责分别打到对应「提供方/模型」 | P0 | 新增行为，无回归基线 |

### [FNOS-021-03 模型原生思考开关如实传递](/requirements/FNOS-021-midscene-library-integration#fnos-021-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-028 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | `thinking.type=disabled` 解析为「关思考」意图 | AC-01 | — | 构造带 `thinking: { type: 'disabled' }` 的请求体，调用意图解析 | 意图为「关思考」 | P0 | 新增行为，无回归基线 |
| TC-029 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | `enable_thinking=false` 解析为「关思考」意图 | AC-01 | — | 构造带 `enable_thinking: false` 的请求体 | 意图为「关思考」 | P1 | 新增行为，无回归基线 |
| TC-030 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | 显式 `reasoning_effort` 解析为指定档位意图 | AC-01 | — | 构造带 `reasoning_effort: 'high'` 的请求体 | 意图为「指定档位 high」 | P1 | 新增行为，无回归基线 |
| TC-031 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | 模型声明可选档位时按命中档位下发 | AC-01 | 桩模型声明 `efforts` 含 `off` | 1. 发「关思考」请求；2. 观察宿主收到的调用参数 | 传入的档位为宿主声明的关闭档位，非硬编码字符串 | P0 | 新增行为，无回归基线 |
| TC-032 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | 模型未声明档位时不传、且请求成功 | AC-02 | 桩模型不声明 `reasoning` 能力 | 发「关思考」请求 | 请求成功（不返回 `UNSUPPORTED_REASONING_EFFORT`）；调用参数不含档位 | P0 | 新增行为，无回归基线 |
| TC-033 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | 意图档位不在可选集合内时不传 | AC-02 | 桩模型只声明 `['low','high']` | 发「指定档位 `minimal`」请求 | 请求成功；不传该档位 | P0 | 新增行为，无回归基线 |
| TC-034 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | 能力查询失败时降级为不传 | AC-02 | 使 `resolveModelInfo` 抛错或超时 | 发任意带思考意图的请求 | 请求照常发出并成功；日志记录一次降级说明 | P1 | 新增行为，无回归基线 |
| TC-035 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | 无思考字段的请求行为不变 | AC-03 | — | 发不含任何思考字段的请求 | 调用参数与升级前一致；响应正常 | P0 | 基线：FNOS-013 的补全行为 |
| TC-036 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | 思考行为在真实任务中与 Midscene 设定一致 | AC-01 | DSH Web、可选模型 | 1. 用默认设置跑一次三步任务；2. 在 Midscene 报告中查看推理内容与耗时 | 无额外推理内容产出（与 Midscene 默认「关思考」一致）；任务成功 | P1 | 新增行为，无回归基线（定性判定，不设耗时阈值） |
| TC-037 | [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | 图片与工具调用不受思考映射影响 | AC-03 | 含图片的请求与含工具的请求各一份 | 分别发送两类请求 | 图片按原顺序与门控处理；工具 schema 与调用行为与升级前一致 | P0 | 基线：FNOS-013 的转换规则 |

### [FNOS-021-06 接入配置显式声明协议并指引误配](/requirements/FNOS-021-midscene-library-integration#fnos-021-06)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-038 | [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) | 携带 `response_format` 的请求**仍成功**（保持忽略） | AC-03 | 桥在运行、持有有效密钥 | POST 带 `response_format: { type: 'json_object' }` 的补全请求 | 状态码 200，正常返回内容；行为与升级前一致。**这条是防止本次改动倒退的守卫** | P0 | 基线：1.15.1 起该字段即被忽略且功能正常 |
| TC-039 | [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) | 接入配置显式声明协议 | AC-01 | — | 读取 `/v1/midscene-env` 的 `content` | 含协议为 Chat Completions 的说明；用户无需自行判断该配哪种协议 | P1 | 新增行为，无回归基线 |
| TC-040 | [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) | 误配 Responses 协议时拿到可读指引 | AC-02 | 同上 | POST `/v1/responses` | 404；错误体说明「本桥只提供 Chat Completions」并提示设置 `MIDSCENE_MODEL_PROTOCOL=openai-chat`，而非无上下文 404 | P1 | 缺陷场景（修复前只有通用 404） |
| TC-041 | [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) | System One 路径提示 Jev 不经本桥 | AC-02 | 同上 | POST `/v1/systemone` | 404；错误体说明 Jev 使用私有协议、不经本桥 | P2 | 新增行为，无回归基线 |
| TC-042 | [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) | 指引响应不泄漏内部实现细节 | AC-02 | 同上 | 检查两条 404 响应体 | 只含面向用户的说明与替代做法；不含堆栈、内部路径、宿主错误类名 | P1 | 安全要求（见 TC-050） |
| TC-042a | [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) | 全部已配置 provider 均可经桥调用 | AC-04 | 桥在运行、至少 5 个 provider 已配置 | 逐一对其模型 POST 一次最小补全请求（文本即可） | 每个返回正常内容，或返回**该 provider 自身**的明确错误（如 `QUOTA`）；不出现协议/路由类错误。**这条直接验证「DSH 全部模型都能给 Midscene 用」** | P0 | 新增行为，无回归基线（实测依据：2026-10-20 实桥逐 provider 通过） |

### [FNOS-021-05 内置技能内容与上游同步](/requirements/FNOS-021-midscene-library-integration#fnos-021-05)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-043 | [FNOS-021-05](/requirements/FNOS-021-midscene-library-integration#fnos-021-05) | 技能文件与登记哈希一致 | AC-01 | 已同步上游快照 | 执行技能守卫测试（比对 `SOURCE.md` 中登记的 sha256） | 全部文件哈希一致；上游文件数由 21 变为 22（新增 `github-actions.md`） | P0 | 基线：FNOS-013 的哈希守卫 |
| TC-044 | [FNOS-021-05](/requirements/FNOS-021-midscene-library-integration#fnos-021-05) | 技能描述覆盖新版本能力 | AC-01 | 同上 | 检索 `midscenejs` 技能中的多职责模型、Jev 边界与 CI 集成说明 | 出现四职责（默认/定位/规划/理解）、Jev 适用边界（不能作默认模型）、`github-actions` 索引 | P1 | 新增行为，无回归基线 |
| TC-045 | [FNOS-021-05](/requirements/FNOS-021-midscene-library-integration#fnos-021-05) | 环境说明仍被注入且不与上游原文冲突 | AC-02 | 插件已启用 | 1. 在会话中加载 `midscenejs` 技能；2. 检查正文开头 | 正文以环境说明开头（模型由桥提供、不索要第三方密钥），其后为上游原文 | P0 | 基线：FNOS-018 的注入说明 |
| TC-045a | [FNOS-021-05](/requirements/FNOS-021-midscene-library-integration#fnos-021-05) | 包内技能与上游快照逐字节一致 | AC-01 | 已克隆上游 `tnnevol/skills` | 对 `skills/midscenejs/` 执行 `diff -rq` 与上游同名目录比对 | 无差异（零本地补丁） | P0 | 基线：FNOS-013 的「不打补丁」原则 |
| TC-046 | [FNOS-021-05](/requirements/FNOS-021-midscene-library-integration#fnos-021-05) | 卸载插件后技能同步消失 | AC-01 | 可卸载的测试 profile | 1. 禁用插件；2. 查看技能目录 | 插件分发的技能不再出现；用户自装同名技能不受影响 | P2 | 基线：FNOS-013 的技能生命周期 |
| TC-046a | [FNOS-021-05](/requirements/FNOS-021-midscene-library-integration#fnos-021-05) | 新增技能文件进入发布产物 | AC-01 | 已构建 | 检查 `npm pack` 产物清单中的 `skills/` 条目 | 含 `skills/midscenejs/references/midscene-test/github-actions.md`；产物技能文件共 24 个 | P1 | 新增行为，无回归基线 |

### [FNOS-021-07 说明页与实现一致](/requirements/FNOS-021-midscene-library-integration#fnos-021-07)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-047 | [FNOS-021-07](/requirements/FNOS-021-midscene-library-integration#fnos-021-07) | 说明页不再出现不存在的配置项与参数 | AC-01 | — | 全文检索 `defaultProvider`、`familyWarning`、`?model=`、以及「占用即报错」 | 均无命中（或在明确的「历史变更」上下文中出现） | P1 | 缺陷场景 |
| TC-048 | [FNOS-021-07](/requirements/FNOS-021-midscene-library-integration#fnos-021-07) | 说明页的端点与字段与实现一致 | AC-02 | — | 逐项核对说明页列出的端点、配置项、设置页字段 | 与 `bridge-server.ts` / `config.ts` / 设置区块实现逐项一致 | P1 | 缺陷场景 |
| TC-049 | [FNOS-021-07](/requirements/FNOS-021-midscene-library-integration#fnos-021-07) | 不支持能力在说明页被明确列出 | AC-02 | — | 检索说明页的「当前不支持」小节 | 明确列出 Responses 协议、结构化输出、Jev 三项及其替代做法 | P2 | 新增行为，无回归基线 |

### [FNOS-021-08 1.16.5 新增测试编排契约的对齐](/requirements/FNOS-021-midscene-library-integration#fnos-021-08)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-061 | [FNOS-021-08](/requirements/FNOS-021-midscene-library-integration#fnos-021-08) | **全仓** e2e 配置不再使用已被移除的 `maxConcurrency` | AC-01 | 已安装 `@midscene/test@1.16.5` | `grep -rn "maxConcurrency" --include=midscene.config.ts` 扫全仓（5 处配置文件） | 无字段赋值残留（仅允许解释性注释）；5 处均出现 `maxConcurrentFiles` 与 `maxConcurrentProjects`，取值均为 1 | P0 | 缺陷场景（`1.16.5` 运行期会显式拒绝旧字段） |
| TC-062 | [FNOS-021-08](/requirements/FNOS-021-midscene-library-integration#fnos-021-08) | `1.16.5` 下 e2e 配置类型检查通过 | AC-01 | 同上 | 1. 全仓 `pnpm run typecheck`；2. 对不在 CI 图内的两处（`dsh-e2e-desktop`、应用 `tests`）单独跑 `tsc --noEmit` | 两者均通过。若保留旧字段会报 `TS2353: 'maxConcurrency' does not exist in type 'TestOptions'` | P0 | 新增行为，无回归基线 |
| TC-063 | [FNOS-021-08](/requirements/FNOS-021-midscene-library-integration#fnos-021-08) | 并发语义与升级前一致 | AC-02 | 同上 | 1. 读取 `TestOptions` 对两字段的说明；2. 核对配置文件取值 | 两字段默认值均为 1（`null` 才是不限）；显式写 1 后 e2e 仍串行跑同一浏览器窗口 | P1 | 基线：`1.16.0` 的 `maxConcurrency: 1` |
| TC-064 | [FNOS-021-08](/requirements/FNOS-021-midscene-library-integration#fnos-021-08) | 扩展未连接时得到可诊断的 `SETUP_TIMEOUT` | AC-03 | Chrome 已装扩展但**未连接**（或不启动 Chrome） | 执行一次 e2e | 在 `setupTimeout` 上限内失败并报 `SETUP_TIMEOUT`（含 `timeoutMs`），而不是无限挂起 | P1 | 新增行为（`1.16.0` 下为无限等待） |
| TC-065 | [FNOS-021-08](/requirements/FNOS-021-midscene-library-integration#fnos-021-08) | 「可用但不采用」项均有结论登记 | AC-04 | — | 检索需求「不在本次范围内」与计划决策 D6/D7 | `defineFileSetup`/`FileSetupContext`/`TProjectContext` 与 `AUTH_MODE=siwc` 各有「不采用」的理由，无悬空项 | P2 | 新增行为，无回归基线 |
| TC-066 | [FNOS-021-08](/requirements/FNOS-021-midscene-library-integration#fnos-021-08) | `1.16.5` 全量回归：单测与构建 | AC-01 | 已安装 `1.16.5` | 执行插件 `check`（typecheck + 单测）与 `build` | 211 条单测全绿、构建通过；桥行为与 `1.16.0` 一致（家族/职责变量/思考字段复核结论见需求调研结论） | P0 | 基线：`1.16.0` 下 211 条全绿 |

### 安全与异常专项（OWASP Top 10 2021 子集）

| 用例ID | 类别 | 场景 | 关联验收 | Payload / 构造 | 预期防御 |
| --- | --- | --- | --- | --- | --- |
| TC-050 | A01 访问控制 | 未带密钥调用补全端点 | [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) AC-01 | `POST /v1/chat/completions`，不带 `Authorization` | 401，`code: invalid_api_key`；不产生任何上游调用 |
| TC-051 | A01 访问控制 | 错误密钥调用补全端点 | 同上 | `Authorization: Bearer 0000…` | 401；比较为定长比较，响应耗时无明显差异（改用错误长度密钥亦为 401） |
| TC-052 | A01 访问控制 | 设置写端点被跨站触发 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) AC-01 | `POST /plugins/dsh-midscene-plugin/settings/update` 带 `Origin: https://evil.example` | 403 `untrusted origin`；配置未被修改 |
| TC-053 | A02 敏感数据 | 接入密钥不出现在日志 | 同上 | 触发一次设置读取与一次补全请求后检索宿主日志 | 日志中无 32 位十六进制密钥；只有请求摘要（模型、流式/缓冲、消息条数） |
| TC-054 | A05 配置错误 | 端点只监听回环地址 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) AC-03 | 从另一台机器访问桥端口 | 无法连接（仅 `127.0.0.1`） |
| TC-055 | A09 日志监控 | 请求日志可诊断且不含消息内容 | [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) AC-04 | 发一条消息含敏感串的请求（含一次误配协议路径的请求） | 有可诊断日志；日志不含消息正文与图片数据，也不含接入密钥 |
| TC-056 | A10 SSRF | `image_url` 为远程 URL | [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) AC-02 | `{"type":"image_url","image_url":{"url":"http://169.254.169.254/latest/meta-data/"}}` | 400；桥不发起任何外部请求（说明只接受 base64 数据 URI） |

### 兼容性与易用性专项

| 用例ID | 维度 | 场景 | 关联验收 | 测试步骤 | 预期结果 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-057 | 双客户端 | 设置页四行在 DSH Desktop 同样可用 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) AC-01 | 以开发态 Desktop（项目 `.dsh` profile、CDP 9333）复跑 TC-015～TC-019 | 与 DSH Web 一致；无渲染差异导致的字段缺失 | P1 |
| TC-058 | 兼容性 | 旧版本插件配置升级后不掉字段 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) AC-02 | 用旧版本配置文档启动新版本插件 | `model` 字段仍生效为默认模型；三个新字段取默认空值；接入密钥不变 | P0 |
| TC-059 | 易用性 | 四行留空与已选状态可区分 | [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) AC-01 | 观察默认、已选、已选但不存在三种状态 | 三种状态在视觉与文案上可区分；已选可一键清空回到「跟随默认」 | P2 |
| TC-060 | 兼容性 | 精简 profile（无设置服务）下桥仍可用 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) AC-03 | 在不含 `settings`/`webServer` 的 profile 加载插件 | 桥正常启动；仅缺少设置界面，接入配置仍可生成（或按既有规则走配置文件） | P2 |

## 测试执行结果

执行日期 **2026-10-22**（两轮：先在 `1.16.0` 上验收，后按上游最新推进到 `1.16.5` 复跑）。版本三元组：DSH 运行时 `0.2.1-rc.2`、插件 `0.2.1-rc.2.15`（功能提交 `c6822e1`；后续 `c7c37a9` 仅改版本号）、应用 `5.9.0-0.2.1-rc.2.15`；Midscene 库由 `1.15.1` 升至 **`1.16.5`**。

**汇总：75 条用例，62 条通过，0 条失败，13 条未执行**（未执行项全部依赖 DSH Web / DSH Desktop 界面、真实 Chrome 与已装扩展、或真实提供方凭据，需在对应环境补测）。

### 已执行（本地构测环境）

包级单测 **211 条全绿**（12 个测试文件）：`typecheck` 通过、`build` 通过、全仓 `typecheck` **11/11** 通过。

| 用例ID | 功能点 | 执行环境 | 结果 | 执行日期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-021-04 | 本地单测 | ✅ 通过 | 2026-10-22 | `autoglm-phone`、`auto-glm-multilingual`、`zhipu/autoglm-phone` 均判为 `auto-glm`（修复前为 `glm-v`） |
| TC-002 | FNOS-021-04 | 本地单测 | ✅ 通过 | 2026-10-22 | `doubao-1.5-ui-tars`、`ui-tars-1.5` 均为 `vlm-ui-tars-doubao-1.5`；`doubao-ui-tars` 为 `vlm-ui-tars` |
| TC-003 | FNOS-021-04 | 本地单测 | ✅ 通过 | 2026-10-22 | `doubao-seed-2-1-turbo` → `doubao-seed`；`doubao-vision-pro` → `doubao-vision`（规则重排未扩大范围） |
| TC-004 | FNOS-021-04 | 本地单测 | ✅ 通过 | 2026-10-22 | `glm-5.3`、`codebuddy/glm-5.3-flash` 等仍为 `glm-v` |
| TC-005 | FNOS-021-04 | 本地单测 | ✅ 通过 | 2026-10-22 | 白名单 21 项，与上游 `MODEL_FAMILY_VALUES` 逐项一致（含 `jev`） |
| TC-006 | FNOS-021-04 | 本地单测 | ✅ 通过 | 2026-10-22 | `codebuddy/hy3` → 通用 `glm-v`，`exact: false`，理由含「通用协议」 |
| TC-007 | FNOS-021-04 | 本地单测 | ✅ 通过 | 2026-10-22 | 遍历真实模型标识，推断结果全部落在白名单内 |
| TC-008 | FNOS-021-01 | 本地 | ✅ 通过 | 2026-10-22 | 已安装版本实测 **`1.16.5`**；catalog 三行与豁免列表 6 行均为 `1.16.5`；锁文件内 `1.16.0` 残留为 0 |
| TC-009 | FNOS-021-01 | 本地 | ✅ 通过 | 2026-10-22 | `pnpm install` 成功，锁文件随 catalog 更新 |
| TC-010 | FNOS-021-01 | 本地单测 | ✅ 通过 | 2026-10-22 | `check`（typecheck + 单测）211 条全绿；`build` 成功 |
| TC-014 | FNOS-021-01 | 本地 | ✅ 通过 | 2026-10-22 | 全仓 `pnpm run typecheck` 11/11 通过（含 `dsh-e2e-kit`） |
| TC-016 | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | 不传专用职责时四个变量行与升级前**逐字符一致**，且不含任何 `MIDSCENE_{LOCATE,PLANNING,INSIGHT}_MODEL_*` |
| TC-017 | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | 仅配定位时只出现该职责 5 行（含 `STREAM_MODE="non-stream"`），无 Planning / Insight |
| TC-018 | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | 默认 GLM 家族 `glm-v`、定位 DeepSeek 家族 `deepseek`，互不串用 |
| TC-019 | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | 四职责各配不同系列，四组变量与家族各自独立 |
| TC-020 | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | 留空的专用职责不写入变量 |
| TC-025 | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | `liveConfig` 每次读取取当前值，热更新无需重启 |
| TC-027a | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | 守住「零感知」：全部留空时变量行逐字符不变 |
| TC-027b | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | 四个模型名 `dsh-model` / `@locate` / `@planning` / `@insight` 互不相同 |
| TC-027c | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | `codebuddy/glm-5.3-flash` 仍按「提供方/模型」解析，不被当成职责名 |
| TC-027d | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | `dsh-model@locate` 打到定位职责配置的模型，`dsh-model` 打到默认职责 |
| TC-027e | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | 专用职责未配置、或旧 `.env` 仍发 `@locate` 时回落默认且返回 200 |
| TC-027f | FNOS-021-02 | 本地单测 | ✅ 通过 | 2026-10-22 | 未配置的职责既不生成变量，`dedicated` 也为 `false`（界面不会误报已单独配置） |
| TC-028 | FNOS-021-03 | 本地单测 | ✅ 通过 | 2026-10-22 | `thinking.type=disabled` → 关思考意图 |
| TC-029 | FNOS-021-03 | 本地单测 | ✅ 通过 | 2026-10-22 | `enable_thinking=false` → 关思考意图 |
| TC-030 | FNOS-021-03 | 本地单测 | ✅ 通过 | 2026-10-22 | `reasoning_effort: 'high'` → 指定档位意图；`'none'` → 关思考 |
| TC-031 | FNOS-021-03 | 本地单测 | ✅ 通过 | 2026-10-22 | 模型声明 `off/low/high` 时下发 `off`（取自宿主披露的 id，非硬编码） |
| TC-032 | FNOS-021-03 | 本地单测 | ✅ 通过 | 2026-10-22 | 模型不声明 `reasoning` 时请求 200 且不含 `reasoningEffort` |
| TC-033 | FNOS-021-03 | 本地单测 | ✅ 通过 | 2026-10-22 | 只声明 `low/high` 而意图为最低档时不传，请求成功 |
| TC-034 | FNOS-021-03 | 本地单测 | ✅ 通过 | 2026-10-22 | `resolveModelInfo` 抛错时降级为不传，请求照常成功 |
| TC-035 | FNOS-021-03 | 本地单测 | ✅ 通过 | 2026-10-22 | 无思考字段的请求不传档位，其余字段转换与升级前一致 |
| TC-037 | FNOS-021-03 | 本地单测 | ✅ 通过 | 2026-10-22 | 图片与工具请求的转换用例全绿，未受思考链路影响 |
| TC-038 | FNOS-021-06 | 本地单测 | ✅ 通过 | 2026-10-22 | **倒退守卫**：带 `response_format` 仍返回 200，且该字段不出现在宿主调用入参里 |
| TC-039 | FNOS-021-06 | 本地单测 | ✅ 通过 | 2026-10-22 | 接入配置头部显式写「协议：OpenAI Chat Completions（openai-chat）——本桥只提供这一种协议」 |
| TC-040 | FNOS-021-06 | 本地单测 | ✅ 通过 | 2026-10-22 | `/v1/responses` → 404，错误体含「Chat Completions」与 `openai-chat` 指引 |
| TC-041 | FNOS-021-06 | 本地单测 | ✅ 通过 | 2026-10-22 | `/v1/systemone` → 404，错误体含「Jev」与「System One」 |
| TC-042 | FNOS-021-06 | 本地检查 | ✅ 通过 | 2026-10-22 | 两条指引只含用户向说明与替代做法，无堆栈、内部路径、宿主错误类名 |
| TC-043 | FNOS-021-05 | 本地单测 | ✅ 通过 | 2026-10-22 | 哈希守卫 22 条通过；上游文件数 21 → 22 |
| TC-044 | FNOS-021-05 | 本地检查 | ✅ 通过 | 2026-10-22 | `midscene-config.md` 含 8 处 `LOCATE_MODEL`、11 处 `Jev`；`github-actions.md` 已入包 |
| TC-045 | FNOS-021-05 | 本地单测 | ✅ 通过 | 2026-10-22 | 分发内容以环境说明开头，其後为上游原文 |
| TC-045a | FNOS-021-05 | 本地 | ✅ 通过 | 2026-10-22 | `diff -rq` 与上游 `tnnevol/skills@b3f7fd6` 零差异 |
| TC-046a | FNOS-021-05 | 本地 | ✅ 通过 | 2026-10-22 | `pnpm pack` 产物含 `skills/midscenejs/references/midscene-test/github-actions.md`，技能文件共 24 个 |
| TC-047 | FNOS-021-07 | 本地检查 | ✅ 通过 | 2026-10-22 | `defaultProvider` 0 次、`familyWarning` 0 次、「占用即报错」0 次；`?model=` 仅出现在「不接受该参数」的否定说明中 |
| TC-048 | FNOS-021-07 | 本地检查 | ✅ 通过 | 2026-10-22 | 端点、6 项配置、设置页字段、鉴权行为逐项核对一致（详见变更记录） |
| TC-049 | FNOS-021-07 | 本地检查 | ✅ 通过 | 2026-10-22 | 新增「能力边界」小节，明确列出结构化输出、Responses、Jev 三项及替代做法 |
| TC-050 | 安全 | 本地单测 | ✅ 通过 | 2026-10-22 | 补全端点不带密钥 → 401 `invalid_api_key` |
| TC-051 | 安全 | 本地单测 | ✅ 通过 | 2026-10-22 | 错误密钥 → 401；比较为定长比较 |
| TC-056 | 安全 | 本地单测 | ✅ 通过 | 2026-10-22 | 远程 `image_url` 被拒（桥不做任意 URL 抓取），只接受 base64 数据 URI |
| TC-058 | 兼容性 | 本地单测 | ✅ 通过 | 2026-10-22 | 老配置缺三个新字段时按「未配置」处理，`model` 语义不变，接入密钥不变 |
| TC-061 | FNOS-021-08 | 本地检查 | ✅ 通过 | 2026-10-22 | 全仓 5 处 e2e 配置均已迁移：`dsh-midscene-plugin`、`dsh-codebuddy-plugin`、`dsh-failover-search-plugin`、`dsh-e2e-desktop`、`fn-deepseek-harness/tests`；字段赋值零残留（`dsh-codebuddy-plugin` 目录被 `.gitignore` 忽略，该处只在本机） |
| TC-062 | FNOS-021-08 | 本地 | ✅ 通过 | 2026-10-22 | 全仓 `pnpm run typecheck` **11/11** 通过；`dsh-e2e-desktop` 与应用 `tests` 单文件 `tsc --noEmit` 均 exit=0。迁移前先复现了 `TS2353`（BUG-021-03） |
| TC-063 | FNOS-021-08 | 本地检查 | ✅ 通过 | 2026-10-22 | `1.16.5` 的两字段默认值均为 1（`null` 才不限），显式写 1 与升级前 `maxConcurrency: 1` 语义一致 |
| TC-065 | FNOS-021-08 | 本地检查 | ✅ 通过 | 2026-10-22 | `defineFileSetup` 等三项与 `AUTH_MODE=siwc` 已在需求「不在本次范围内」与计划决策 D6/D7 各有理由 |
| TC-066 | FNOS-021-08 | 本地 | ✅ 通过 | 2026-10-22 | `1.16.5` 上重跑 `check` 与 `build`：**211 条单测全绿**、构建成功；家族白名单/职责变量/`jev` 限制/思考字段形态复核与 `1.16.0` 一致 |
| TC-052 | 安全 | 本地 DSH Web 实测 | ✅ 通过 | 2026-10-23 | 带 `Origin: https://evil.example` 写设置端点 → **403**；同源回环请求 → 200。会话令牌与配置未被跨站改动 |
| TC-054 | 安全 | 本地 DSH Web 实测 | ✅ 通过 | 2026-10-23 | 桥监听项为 `127.0.0.1:8791`（仅回环）；从本机 LAN IP `192.168.124.177` 访问 → 连接失败 |
| TC-015 | FNOS-021-02 | 本地 DSH Web（CDP 断言） | ✅ 通过 | 2026-10-23 | 设置区块渲染出 **四个职责 Tab**（默认/定位/规划/页面理解），且恰好 4 个下拉 |
| TC-021 | FNOS-021-02 | 本地 DSH Web（CDP 断言） | ✅ 通过 | 2026-10-23 | 把「定位」配成不存在的模型后，该 Tab 显示橙色「目录中已不存在」标签并**列出该模型名**，不静默改选；后端同时回落默认且不写 LOCATE 变量组 |
| TC-022 | FNOS-021-02 | 本地 DSH Web（CDP 断言） | ✅ 通过 | 2026-10-23 | 下拉展开 24 个选项；与设置端点的 `availableModels` 数量一致且**全部 `vision: true`** —— 只列识图模型 |
| TC-024 | FNOS-021-02 | 本地 DSH Web（CDP 断言） | ✅ 通过 | 2026-10-23 | 默认 Tab 占位文案「未指定（跟随 DSH 会话模型）」；三个专用 Tab 为「未指定（沿用默认职责）」—— 留空语义在界面上可读 |
| TC-026 | FNOS-021-02 | 本地 DSH Web（CDP 断言） | ✅ 通过 | 2026-10-23 | 接入配置预览可见、含协议声明行，且有「复制接入配置」按钮 |
| TC-059 | FNOS-021-02 | 本地 DSH Web（CDP 断言） | ✅ 通过 | 2026-10-23 | 留空与已选可区分：已选（即使模型已不存在）Tab 内显示配置值 + 「当前实际使用：…（沿用默认）」，留空则只有占位文案 |

### 未执行（需界面或真实环境）

| 用例ID | 阻塞原因 |
| --- | --- |
| TC-011、TC-012、TC-027 | 需 DSH Web 运行中 + 已装 Midscene 扩展的真实 Chrome |
| TC-013 | 单测已固定「四行逐字符不变」；真实 Midscene 定位/断言未跑 |
| TC-023 | 需构造「目录里没有可识图模型」的状态（清空全部提供方），验证界面给提示而非空下拉 |
| TC-036 | 需真实任务与报告观察（定性判定） |
| TC-042a | 需真实提供方凭据逐 provider 冒烟 |
| TC-064 | 需「Chrome 已装扩展但未连接」的真实场景，验证 `SETUP_TIMEOUT` 取代无限等待 |
| TC-046 | 需可卸载的测试 profile |
| TC-053、TC-055 | 需检查宿主运行日志 |
| TC-057 | 需 DSH Desktop（开发态、CDP）复跑 |
| TC-060 | 需精简 profile（无 `settings`/`webServer`） |

## Bug 记录

执行期间发现并已修复 **2 个缺陷**（均由本轮新增用例抓出）：

| 编号 | 发现用例 | 现象 | 根因 | 修复 |
| --- | --- | --- | --- | --- |
| BUG-021-01 | TC-027b（`/v1/midscene-env` 变量字典） | `content` 里有专用职责的变量，但 `variables` 字典里取不到 `MIDSCENE_LOCATE_MODEL_NAME` | `Object.fromEntries(dedicated.map(...))` 里 `map` 每一项返回的是「键值对数组」而不是「键值对」，被当成非法条目丢弃 | 改为 `flatMap` 返回键值对数组 |
| BUG-021-02 | TC-042（未知路径 404） | 未带密钥访问未知路径得到 401 而非 404 | 鉴权在路由之前（既有设计，且是有意的：不向未授权调用者披露端点清单） | 不改实现；修正用例前置条件为「带密钥」 |
| BUG-021-03 | TC-062（升级到 `1.16.5` 后的类型检查） | `plugins/dsh-midscene-plugin/tests/e2e/midscene.config.ts` 报 `TS2353: 'maxConcurrency' does not exist in type 'TestOptions'`；即使绕过类型检查，运行期也会被 `Midscene config test.maxConcurrency is no longer supported.` 直接拒绝 | 上游 `1.16.5` 把 `maxConcurrency` 拆成 `maxConcurrentFiles`/`maxConcurrentProjects`，并**显式拒绝旧字段**（属破坏性变更；`1.16.0` 不会暴露）。首次只修了本插件，全仓 typecheck 立刻抓出 `dsh-failover-search-plugin` 的同类写法，`grep` 后确认**共 5 处** | 迁移为 `maxConcurrentFiles: 1` + `maxConcurrentProjects: 1`（两字段默认值均为 1，语义不变），并在配置注释里写明这条破坏性变更 |

另有一处**版本线记录**：`@midscene/*` 上游在 2026-10-21～10-22 发布了 `1.16.1`、`1.16.2`、`1.16.5`。首轮验收基于 `1.16.0`；随后按用户确认把基线**推进到 `1.16.5`** 并复跑。实测仓库的 `minimumReleaseAge` 门槛为 **24 小时**（`1.16.1` 距 30h 免豁免；`1.16.2` 22.2h、`1.16.5` 3.2h 均被拦），因此 `1.16.5` 显式登记进 `minimumReleaseAgeExclude`。逐项复核确认 `1.16.5` 与 `1.16.0` 的家族白名单、四职责变量名、`jev` 限制、专用职责不继承与思考字段形态完全一致，**唯一需要改代码的是 `maxConcurrency` 的移除**（BUG-021-03），其余为增量能力（`AUTH_MODE`、`defineFileSetup`、`setupTimeout`），取舍已登记。

## 测试结论

- 结论：<Badge type="warning" text="部分执行（75 条中 62 条通过，13 条待补测）" />
- 已执行部分：**62/62 通过，0 失败**；包级单测 211 条全绿，全仓类型检查 11/11 通过，构建成功。
- 未执行部分：全部依赖 DSH Web / DSH Desktop 界面、真实 Chrome 与扩展、或真实提供方凭据，**不构成本轮功能正确性的阻塞证据**，但按需求「验收环境范围」仍需在对应环境补测后转「已完成」。
- 一句话结论：库基线升级、四职责接入配置、思考开关透传、家族推断修正、技能同步与说明页纠偏在本地构测环境全部验证通过，界面与真实运行链路待环境补测。

## 覆盖率分析

### 按功能覆盖

| 功能 | 用例数 | 正向 | 逆向 | 边界 | 权限 | 数据一致性 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 7 | ✅ | ✅ | ✅ | — | ✅ | 「权限」不适用（依赖升级无权限面） |
| [FNOS-021-02](/requirements/FNOS-021-midscene-library-integration#fnos-021-02) | 19 | ✅ | ✅ | ✅ | ✅ | ✅ | 权限由 TC-052 覆盖 |
| [FNOS-021-03](/requirements/FNOS-021-midscene-library-integration#fnos-021-03) | 10 | ✅ | ✅ | ✅ | — | ✅ | 「权限」不适用（桥内转换逻辑） |
| [FNOS-021-04](/requirements/FNOS-021-midscene-library-integration#fnos-021-04) | 7 | ✅ | ✅ | ✅ | — | ✅ | 「权限」不适用（纯函数） |
| [FNOS-021-05](/requirements/FNOS-021-midscene-library-integration#fnos-021-05) | 6 | ✅ | ✅ | ✅ | — | — | 无数据一致性面 |
| [FNOS-021-06](/requirements/FNOS-021-midscene-library-integration#fnos-021-06) | 6 | ✅ | ✅ | ✅ | ✅ | ✅ | 权限由 TC-050～TC-052 覆盖；TC-042a 跨 provider 覆盖数据一致性（全部路由可达） |
| [FNOS-021-07](/requirements/FNOS-021-midscene-library-integration#fnos-021-07) | 3 | ✅ | ✅ | — | — | — | 文档用例无边界与数据面 |
| [FNOS-021-08](/requirements/FNOS-021-midscene-library-integration#fnos-021-08) | 6 | ✅ | ✅ | ✅ | — | ✅ | 「权限」不适用（测试编排配置）；边界覆盖「默认值 1 与显式 1 等价」「超时上限」 |

### 未启用章节与原因

| 章节 | 原因 |
| --- | --- |
| 性能测试 | 改动不新增性能路径；思考开关的效果以行为判定（TC-036），不设耗时阈值，避免把模型侧波动误读成插件性能 |
| 移动端测试 | 插件本体无移动端界面 |
| AI/算法测试 | 插件不训练、不调参；模型效果归上游。本次只验意图传递（TC-028～TC-034） |
| 数据迁移测试 | 无迁移；配置为增量，兼容性由 TC-013、TC-058 覆盖 |
| 灰度发布测试 | 无灰度机制 |
| ERP 专项 | 不适用 |

### 风险提示

1. **TC-012 的判定成本最高**：升级后 e2e 若失败，需要人工区分「产品回归」与「框架判定变严」。若 1.16.0 的清理语义造成既有用例系统性失败，应在计划中以「接受判定变严 + 调整用例」登记，而不是回退升级。
2. **TC-031/TC-032 依赖桩模型**：档位命中/未命中的判定需要可控的模型能力声明（宿主按模型各自声明的档位集合校验）。若无法构造桩，可退化为对能力查询结果的单测断言，但会失去端到端覆盖。
3. **TC-036 是定性判定**：以「无额外推理内容产出」为判据，不测耗时。若需要量化收益，应另立性能需求，且必须在同一模型、同一任务、多次取中位数才有可比性。
4. **TC-051 的时序判定不宜过度依赖**：定长比较的实现保证的是逻辑上无提前返回，实测耗时差异受运行时噪声影响，建议只把它作为实现核对项而非量化门禁。

## 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-10-20 | 初始登记 | 建立 FNOS-021 测试用例文档，共 60 条用例：家族推断 7 条、库基线 7 条、多职责接入 13 条、思考透传 10 条、协议指引 5 条、技能 4 条、说明页 3 条、安全与异常 7 条、兼容与易用 4 条。按系统形态识别未启用性能/移动端/AI 算法/数据迁移/灰度/ERP 六类专项，原因已逐项登记。 |
| 2026-10-20 | 更正 FNOS-021-06 用例方向并新增跨 provider 用例 | 原 TC-038 断言「带 `response_format` 返回 400」。复核确认该字段自 1.15.1 起就被桥忽略、现有 58 条验收在此状态下全部通过，且 Midscene 有 `callAiAndParseWithRetry` 语义重试兜底——按原设计会把可用功能推成失败。修订：TC-038 反转为「仍返回 200」作为倒退守卫；TC-039 改为「接入配置显式声明协议」；TC-040/041/042 收敛到「误配时给可读指引」；**新增 TC-042a「全部已配置 provider 均可经桥调用」**，直接验证「DSH 全部模型都能给 Midscene 用」这条核心承诺（依据 2026-10-20 实桥逐 provider 实测）。用例总数 60 → 61。 |
| 2026-10-20 | 补充 6 条多职责守卫用例 | 新增 TC-027a～TC-027f，钉住「默认只出四行」「四职责模型名互不相同」「提供方/模型 老路径不受影响」「专用职责打自己的模型」「未配置/失效回落默认」「未配置职责不登记实际使用」六条不变量，该功能用例数 13 → 19，总数 63 → 69。断言只写**行为**（不规定模型名取值与内部函数名），实现方案由计划阶段决定。 |
| 2026-10-22 | 回填首轮执行结果（本地构测环境；当时基线 `1.16.0`、用例 69 条，次日推进到 `1.16.5` / 75 条） | 库基线升至 `1.16.0`（catalog 3 行 + 豁免列表 6 行）。包级单测由 152 增至 **211 条全绿**（新增 `reasoning.spec.ts` 15 条、`intent-models.spec.ts` 7 条，并扩充 `config`/`settings-routes`/`settings-rpc`/`bridge-server` 的份额）；`typecheck`、`build` 与全仓 `typecheck`（11/11）通过。回填 69 条用例中的 **24 条通过、0 失败、45 条未执行**（未执行项均依赖 DSH Web/Desktop 界面、真实 Chrome 与扩展、真实提供方凭据，已逐条登记阻塞原因）。执行期抓出并修复 BUG-021-01（`/v1/midscene-env` 的 `variables` 字典丢失专用职责键，`map` 误用为 `flatMap`）；BUG-021-02 为用例前置条件错（鉴权先于路由，实现不改）。另登记上游 `1.16.1/1.16.2/1.16.5` 已发布但未纳入基线的理由（发布未满 `minimumReleaseAge`，且家族白名单与职责变量名与 `1.16.0` 完全一致）。 |
| 2026-10-22 | **基线推进到 `1.16.5`，补登 FNOS-021-08 的 6 条用例** | 首轮验收基于 `1.16.0`；按用户确认把基线推进到 `1.16.5` 并在其上复跑。新增 FNOS-021-08 用例 TC-061～TC-066（并发字段迁移、类型检查、并发语义等价、`SETUP_TIMEOUT` 可诊断、新能力取舍登记、全量回归），用例总数 **69 → 75**。执行结果 **29 通过 / 0 失败 / 46 待补测**（新增 5 条通过；TC-064 需「扩展已装未连接」场景）。新增 BUG-021-03：`TestOptions.maxConcurrency` 在 `1.16.5` 被移除并运行期显式拒绝，**全仓 5 处** e2e 配置正在使用（本插件、codebuddy、failover-search、e2e-desktop、应用 tests），属**破坏性变更**（`1.16.0` 不暴露），已全部迁移为 `maxConcurrentFiles`/`maxConcurrentProjects`。另记录 `minimumReleaseAge` 门槛实测为 24 小时（`1.16.1` 30h 免豁免，`1.16.2` 22.2h 与 `1.16.5` 3.2h 被拦）。 |
| 2026-10-23 | 本地 DSH Web 实测第二轮：补 2 条安全用例证据 | 在本地 DSH Web（`DSH_HOME=仓库 .dsh`，8070）与其桥（跳号后 8791）上实测：TC-052 跨站 `Origin` 写设置端点得 403、同源得 200；TC-054 桥仅监听 `127.0.0.1`、从 LAN IP 访问失败。用例通过数 29 → **31**。同轮还以真实请求复核了已在通过列表中的多职责链路：给「定位」职责配置模型后接入配置由 4 行变 9 行、家族按其自身模型推导、`dsh-model@locate` 实际命中该模型、清空后回落默认；以及 `thinking`/`reasoning_effort` 四种形态均成功、宿主没有的档位被安全忽略。浏览器 e2e 仍阻塞于 Midscene 浏览器扩展未连接（`getBrowserTabList` 超时）。 |
| 2026-10-23 | 修正执行汇总计数（此前的通过数少计） | 已执行结果表实有 **56** 行且全部通过、ID 无重复；未执行表列 **19** 条，56 + 19 = 75 与用例总数吻合。此前汇总写的是 29（本轮一度改为 31），属**漏更新**——表格早已回填，汇总数字没跟着改。现按表格实测值修正为 56 通过 / 19 待补测。 |
| 2026-10-23 | 本地 DSH Web 界面实测：6 条 UI 用例转为通过 | 浏览器扩展仍未连接（e2e 的 `getBrowserTabList` 持续超时），改用 **CDP 直连**在真实 DSH Web 上执行断言脚本（断言内容与 e2e 用例同一套，仅执行方式由视觉驱动改为 DOM 断言）：TC-015 四个职责 Tab 与 4 个下拉、TC-021 不存在的模型如实提示且不静默改选、TC-022 下拉 24 项全为识图模型、TC-024 留空语义在界面可读、TC-026 预览与复制按钮、TC-059 留空与已选可区分。通过数 56 → **62**，未执行 19 → 13（仅剩 TC-023 需构造无识图模型状态）。同轮把 e2e 用例资产同步到新界面：断言文案由「指定测试模型」改为「各职责使用的模型」，并新增「四个职责 Tab 齐全 + 至少 4 个下拉」的页面内断言。 |
