---
id: FNOS-021
title: FNOS-021 测试用例
description: FNOS-021 Midscene 库能力对齐与接入简化的测试用例、执行结果与问题记录。
requirement: /requirements/FNOS-021-midscene-library-integration
plan: /plans/PLAN-FNOS-021-midscene-library-integration
status: 规划中
lastVerified: 2026-10-20
verifiedAt: 2026-10-20
---

# FNOS-021 测试用例

| 字段 | 内容 |
| --- | --- |
| 需求编号 | FNOS-021 |
| 关联需求 | [FNOS-021 Midscene 库能力对齐与接入简化](/requirements/FNOS-021-midscene-library-integration) |
| 关联计划 | [PLAN-FNOS-021 Midscene 库能力对齐与接入简化](/plans/PLAN-FNOS-021-midscene-library-integration) |
| 测试状态 | <Badge type="info" text="规划中（用例已登记，待执行）" /> |
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

- **升级引入「判定变严」而非真实回归**：`1.16.0` 强化了资源清理语义，既有 e2e 可能出现新的失败。判定时必须区分「产品坏了」与「框架判得更严」，否则会误改被测应用（TC-012 专为此设计）。
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

**版本基线（执行时填写）**：DSH `0.2.1-rc.2` / 插件 `@tnnevol/dsh-midscene@<待填>` / 应用 `5.9.0`；额外记录 Midscene 库版本（应为 `1.16.0`）。

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
| TC-008 | [FNOS-021-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 三个直接依赖均为 1.16.0 | [AC-01](/requirements/FNOS-021-midscene-library-integration#fnos-021-01) | 已执行安装 | 1. 读取 `node_modules/@midscene/{web,test,computer}/package.json`；2. 核对 workspace catalog 三行与豁免列表 6 行 | 三包版本均为 `1.16.0`；catalog 与豁免列表均为 `1.16.0` | P0 | 新增行为，无回归基线 |
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

尚未执行（用例已登记 69 条，全部待执行）。执行后按「用例ID / 功能点 / 执行环境 / 结果 / 执行日期 / 备注」回填，备注需包含版本三元组（DSH 运行时、插件版本、应用版本）与 Midscene 库版本。

## Bug 记录

尚未执行，无 Bug 记录。

## 测试结论

- 结论取值：<Badge type="info" text="尚未执行" />
- 计划目标：执行完成后给出「执行用例总数 / 通过数 / 失败数 / 遗留 Bug 数」与一句话结论。

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
