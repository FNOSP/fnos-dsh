---
id: FNOS-055
title: FNOS-055 测试用例
description: FNOS-055 安装向导移除失效 npm 镜像源的用例、包级执行结果与真实 NAS 遗留项。
requirement: /requirements/FNOS-055-invalid-npm-mirror-removal
plan: /plans/PLAN-FNOS-055-invalid-npm-mirror-removal
status: 部分通过
lastVerified: 2026-11-18
verifiedAt: 2026-11-18
---

# FNOS-055 测试用例

## 测试范围与需求分析

被测对象是「安装、升级与应用设置向导的 npm 镜像源清单」与「安装/升级回调对历史失效地址的处理」。执行任务见 [PLAN-FNOS-055](/plans/PLAN-FNOS-055-invalid-npm-mirror-removal)。

| 功能 | 覆盖点 | 关键风险 |
| --- | --- | --- |
| [FNOS-055-01](/requirements/FNOS-055-invalid-npm-mirror-removal#fnos-055-01) | 三份向导源清单 | 只改一份；官方默认值或其余源被误删 |
| [FNOS-055-02](/requirements/FNOS-055-invalid-npm-mirror-removal#fnos-055-02) | 旧值归一 | 匹配过宽误改自定义源；归一位于写配置之后而失效 |
| [FNOS-055-03](/requirements/FNOS-055-invalid-npm-mirror-removal#fnos-055-03) | 失败信息 | 只改文案不改实际使用的 registry，或丢掉原步骤信息 |
| [FNOS-055-04](/requirements/FNOS-055-invalid-npm-mirror-removal#fnos-055-04) | 文案与守卫 | 九语言遗漏；把工具箱 nrm 的源列举误删 |

## 测试环境

| 功能 | 目标环境 | 执行方式 |
| --- | --- | --- |
| FNOS-055-01、04 | 包级（Node / vitest） | `tooling/fnos-dsh-cli/tests/fnos-007-baseline.spec.ts` |
| FNOS-055-02、03 | 包级（Node / vitest）＋ shell 语法 | `packages/fnos-gateway/tests/npm-registry.spec.ts`；`bash -n cmd/install_callback` |
| FNOS-055-01~03 | 真实 fnOS NAS | 应用中心全新安装与升级（**未执行**，待 FPK） |
| FNOS-055-04 | 文档站构建环境 | `pnpm --filter @tnnevol/fn-os-apps-docs build`；`check --sdd --i18n` |

> 包级说明：`packages/fnos-gateway` 的部分用例会执行构建产物
> `apps/fn-deepseek-harness/app/scripts/install-callback-helper.mjs`。该产物不入库，
> 首次运行前需执行 `pnpm --filter @tnnevol/fnos-gateway build:app`；缺失时
> `bundled-plugin-install.spec.ts` 的 3 条按真实 helper 检测的用例会失败，属环境前置，
> 不是产品缺陷。

## 测试用例

### [FNOS-055-01 向导不再提供失效镜像源](/requirements/FNOS-055-invalid-npm-mirror-removal#fnos-055-01)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | FNOS-055-01 | 三份向导都不再出现失效源 | AC-01 | 无 | 1.解析 `wizard/install`、`upgrade`、`config`；2.检查选项 label 与 value | 均无 `npmMirror`；无 `skimdb.npmjs.com` / `replicate.npmjs.com` | P0 | issue #36 |
| TC-002 | FNOS-055-01 | 官方默认与其余源不变 | AC-02 | 无 | 1.比对三份选项顺序与 `initValue` | npm 官方第一且默认；yarn/tencent/cnpm/taobao/huawei 仍在；共 6 项 | P0 | FNOS-007-23/28 |
| TC-003 | FNOS-055-01 | 真实 NAS 选择 taobao 可安装 | AC-03 | FPK、真实 fnOS NAS | 1.应用中心全新安装；2.选择 taobao；3.等待服务就绪 | 安装完成且 DSH Web 可打开 | P0 | 提出人临时规避路径 |
| TC-014 | FNOS-055-01 | FPK 产物与源码同步 | AC-01、AC-02 | 已构建 x86 FPK | 1.解包 FPK；2.检查三份向导、`install_callback`、`app.tgz` 内 helper 与 i18n | 三份向导无失效源且均 6 项；回调含归一调用；helper 含 `normalize-npm-registry`；中文文案含第 15 条 | P0 | 发布产物 |

### [FNOS-055-02 旧配置自动恢复](/requirements/FNOS-055-invalid-npm-mirror-removal#fnos-055-02)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-004 | FNOS-055-02 | 失效地址的多种写法都归一 | AC-01 | 无 | 1.对 `http`/`https`、带/不带结尾斜杠、大小写、跳转后地址 7 个样本调用 `normalizeNpmRegistry` | 全部返回 `https://registry.npmjs.org/` | P0 | 安装回调持久化路径 |
| TC-005 | FNOS-055-02 | 自定义源与相似域名不被改写 | AC-02 | 无 | 1.对官方、五个镜像、自建源、相似域名、同主机其它路径 9 个样本调用 | 原值返回（仅去首尾空白） | P0 | 误改风险 |
| TC-006 | FNOS-055-02 | 空值与幂等 | AC-01、AC-02 | 无 | 1.空串与空白；2.对全部样本二次调用 | 空值保持空；二次调用结果不变 | P1 | 重复安装/升级 |
| TC-007 | FNOS-055-02 | 归一接在写配置之前 | AC-01、AC-03 | 无 | 1.检查回调源码：帮助器调用、`NORMALIZED_NPM_REGISTRY`、`persist_npm_registry` 的相对位置；2.`bash -n` | 归一调用先于写配置；脚本语法通过 | P0 | 单点归一决策 |
| TC-008 | FNOS-055-02 | 已持久化失效地址升级后自愈 | AC-01、AC-03 | FPK、真实 fnOS NAS、可控旧值 | 1.用中间构建让升级向导写入失效地址；2.升级到修复版；3.读日志与 `.npmrc` | 日志记录原值→官方源；`.npmrc` 已更新；应用启动正常 | P0 | 真实历史配置 |

### [FNOS-055-03 安装失败信息可定位](/requirements/FNOS-055-invalid-npm-mirror-removal#fnos-055-03)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-009 | FNOS-055-03 | pnpm 失败信息带出 registry | AC-01 | 无 | 1.检查回调失败分支文案 | 含实际 `NPM_REGISTRY` 与换源提示；保留包名与版本 | P1 | issue #36 建议 2 |
| TC-010 | FNOS-055-03 | 真实 NAS 上失败提示可见 | AC-01、AC-02 | 可控失败场景 | 1.在真实 NAS 触发 pnpm 安装失败；2.查看界面与日志 | 界面/日志含 registry；未丢失原有步骤信息 | P1 | 待真机 |

### [FNOS-055-04 向导与发布说明一致](/requirements/FNOS-055-invalid-npm-mirror-removal#fnos-055-04)

| 用例ID | 功能点 | 测试标题 | 关联验收 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 基线来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-011 | FNOS-055-04 | 九语言发布说明记录修复 | AC-02 | 无 | 1.`check --i18n`；2.检查九语言 `changelog` 第 15 条与 `desc` | 九语言均含修复说明；`desc` 中 nrm 源列举保持原样 | P1 | 应用中心展示 |
| TC-012 | FNOS-055-04 | 文档与索引可达 | AC-01 | 无 | 1.`check --sdd`；2.文档站构建 | 文档检查通过；需求/计划/测试页构建成功 | P1 | 菜单规范 |
| TC-013 | FNOS-055-04 | 帮助器子命令在构建产物中可用 | AC-01 | 已运行 `build:app` | 1.对失效地址、普通镜像、空值各执行一次 `normalize-npm-registry` | 输出依次为官方源、原值、空 | P0 | 安装期真实入口 |

## 测试执行结果

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| TC-001、TC-002 | 通过 | `fnos-007-baseline.spec.ts` 16 条通过；三份向导均为 6 个选项，官方源第一且默认 |
| TC-004 ~ TC-006 | 通过 | `npm-registry.spec.ts` 归一矩阵 6 条通过（含 7 个失效写法、9 个保留样本、空值与幂等） |
| TC-007、TC-009 | 通过 | `npm-registry.spec.ts` 接线 2 条通过：归一在 `persist_npm_registry` 之前；失败信息含 `${NPM_REGISTRY}`；`bash -n cmd/install_callback` 通过 |
| TC-013 | 通过 | `build:app` 后实跑：`skimdb` → `https://registry.npmjs.org/`；`npmmirror` → 原值；空值 → 空 |
| TC-014 | 通过 | x86 FPK（`v8.1.155-dsh-0.2.2-rc.1`）解包：三份向导 `npmMirror` 命中 0、均 6 项；`cmd/install_callback` 与 `app.tgz` 内 helper 均含归一子命令；`i18n/zh-CN` 含第 15 条 |
| TC-011 | 通过 | `check --i18n`：9 语言 × 46 键通过；九语言 `changelog` 均追加第 15 条，`desc` 的 nrm 列举未改 |
| TC-012 | 通过 | `check --sdd` 通过；文档站构建通过 |
| 网关全量 | 通过 | `pnpm --filter @tnnevol/fnos-gateway test`：28 个文件、188 条通过 |
| CLI 全量 | 通过 | `pnpm --filter @tnnevol/fnos-dsh-cli test`：16 个文件、163 条通过 |
| typecheck / lint | 通过 | 两个包 `tsc` 通过；变更文件 `eslint` 0 error |
| TC-003、TC-008、TC-010 | 未执行 | 需要 FPK 与真实 fnOS NAS；按计划 T04-02/T04-03 在应用中心走安装与升级路径 |

## 问题记录

| 编号 | 现象 | 定位 | 处置 |
| --- | --- | --- | --- |
| ENV-055-01 | 首次跑网关用例时 `bundled-plugin-install.spec.ts` 3 条失败，输出为空 | `apps/fn-deepseek-harness/app/scripts/install-callback-helper.mjs` 未生成，用例转发到不存在的产物 | 先执行 `pnpm --filter @tnnevol/fnos-gateway build:app` 再跑，188 条全过；属环境前置，非产品缺陷 |
| BUG-055-01 | 新用例用普通字符串断言 `${NPM_REGISTRY}` 触发 `no-template-curly-in-string` | eslint 规则与 shell 变量字面量冲突 | 改为正则匹配，语义不变；`eslint` 复跑 0 error |

## 最终结论

包级结论：三份向导已移除失效源且其余源、默认值与字段顺序保持不变；归一模块对已知失效地址（含 http/https、结尾斜杠、大小写与跳转后地址）全部收敛到 npm 官方源，对自定义源与相似域名不改写；归一接在写配置之前，失败信息已带出实际 registry；九语言发布说明与文档索引同步完成；x86 FPK 产物中三份向导、安装回调与帮助器均与源码一致。网关 188 条、CLI 163 条用例全绿。

真实环境结论待补：需构建 FPK 后在真实 fnOS NAS 完成 TC-003（全新安装选 taobao 可装成）、TC-008（历史失效配置升级后自愈）与 TC-010（失败提示可见）。这三项完成前，需求状态保持「实施中」，不标记完成。
