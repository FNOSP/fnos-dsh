---
feature: FNOS-008-01
acceptance: FNOS-008-01-AC-05, FNOS-008-01-AC-06
environment: 本地（源码与构建产物核对；本机 web profile 未挂载 fnOS 插件，故无运行时渲染证据）
fnosVersion: 不适用
appVersion: 0.1.7-rc.2
pluginVersion: 0.1.7-rc.2
verifiedAt: 2026-09-29
status: passed
---

# FNOS-008-01 授权目录上限与 proxy 说明微调本地验证记录（2026-09-29）

本记录补登 FNOS-008-01-AC-05、AC-06：授权目录列表上限由 500px 改为 300px，
「三方插件 proxy」的说明改为固定三行并更正用途表述与举例。

## 一、呈现问题

### 列表上限

授权目录列表原为 `max-height: 500px`。实机截图显示该高度偏高：详情页里它下面
紧邻「三方插件 proxy」与保存按钮，500px 的列表把两者推到首屏之外，用户看不到
保存入口。改为 **300px**。

滚动位置不变，仍放在**列表自己**身上（`.dsh-fnos-authorized-path-list`）而非卡片
或 body——若放在卡片上，用户滚到列表底部时保存按钮会一起被卷走。

### 说明文案

原说明是一整句：

> 反向代理：把以这些前缀开头的请求转发给本机其它服务，用于让三方插件访问本地 API。
> 每行填一个以 / 开头的绝对路径前缀，保存后刷新页面即生效。例如填 /plugin-api 后，
> 访问 /plugin-api/xxx 会转发到对应服务。

三个问题：

1. **没有分段**。是什么 / 怎么写 / 举例子挤在一段里，悬浮层中读者很难扫读。
2. **用途表述不准**。「转发给本机其它服务」把 proxy 说成了通用本机反代；它的实际
   定位是把三方插件的绝对路径 API **统一接入应用网关**，由网关按前缀转发。
3. **举例不可用**。例子给的是 `/plugin-api/xxx`（前缀 + 占位符），读者仍要自己判断
   「前缀该填到哪一段为止」。应给一个真实形态的插件 API 路径：`/plugin-api/get/me`
   → 填 `/plugin-api`。

## 二、本次实现

`locales.ts`：`gatewayProxyDescription`（中英各一条）改为固定三行，行间用 `\n`：

| 行 | 内容 |
| --- | --- |
| 是什么 | 把三方插件的绝对路径 API 统一接入应用网关，由网关按前缀转发到对应服务 |
| 怎么写 | 一行填一个以 `/` 开头的绝对路径前缀，保存后刷新页面生效 |
| 举例子 | 插件 API 是 `/plugin-api/get/me`，就填 `/plugin-api` |

`styles/index.scss`：列表上限改 300px；新增

```scss
.semi-tooltip-wrapper.dsh-fnos-gateway-tip-content {
  max-width: 320px;
  white-space: pre-line;
}
```

`AuthorizedDirectoriesCard.tsx`：`DshTooltip` 加
`className="dsh-fnos-gateway-tip-content"`。

### 为什么必须用专用类

换行要渲染出来就得上 `white-space: pre-line`，而这个属性必须落在**浮层本体**上，
文案才是它的文本内容。浮层是 portal 到 `body` 的，不在组件子树里，组件内写样式
命中不到，只能靠类名。类名又不能直接加在 `.semi-tooltip-wrapper` 上——那是所有
提示共用的，加 `pre-line` 会让别处依赖单行折叠的提示一起变形。因此用一个专用类，
选择器写成两类的复合（`.semi-tooltip-wrapper.dsh-fnos-gateway-tip-content`）：
既命中浮层本体，又只影响这一处。

用 `pre-line` 而非 `pre-wrap`：两者都保留换行、都在超宽时自动折行，区别在连续空格
——`pre-wrap` 照原样留出，`pre-line` 折叠为单个空格。这段文案是散文，要后者。

**属性是否真能到达文本**：`.semi-tooltip-content` 是浮层内层的子元素，Semi 对它的
唯一声明是 `min-width: 0`（见 `@douyinfe/semi-ui/dist/css/semi.css`），
全文检索 Semi 的 tooltip 相关规则中**没有任何** `white-space` 声明，因此本规则经
继承到达文本、不会被内层覆盖。

## 三、验证证据

### 契约测试（`tests/client/detail-section-ui.spec.ts`）

原有 16 条中 2 条随本次改动作废并重写，净增 4 条，共 20 条：

| 用例 | 断言 |
| --- | --- |
| `列表容器有 300px 上限并允许纵向滚动` | 规则含 `max-height: 300px` 与 `overflow-y: auto` |
| `滚动的是列表本身，不是整页` | 上限在列表规则上，不在 `.dsh-fnos-authorized-card-body` |
| `描述固定三行：是什么 / 怎么写 / 举例子` | `split('\n')` 长度 3；逐行断言关键词；第三行含 `/plugin-api/get/me` 与 `/plugin-api` |
| `源码里的换行是转义序列，运行时才成为真换行` | 文案含 `\n` |
| `说明点明 proxy 的作用是接入统一网关` | 匹配「统一接入 / 接入…网关 / 网关…接入」 |
| `tooltip 带专用类，换行才渲染得出来` | 组件含 `className="dsh-fnos-gateway-tip-content"`；该规则含 `white-space: pre-line` |
| `多行样式只作用于本 tip，不改动共用提示外观` | 不存在裸 `.semi-tooltip-wrapper { … white-space … }` 规则 |

`zhCopy` 取的是**源码字面量**，其中 `\n` 是两个字符（反斜杠 + n），断言行结构前
须按 JS 规则解回真换行；上表第 4 条正是把这一前提也钉住。

### 逐条反转验证

| 反转项 | 结果 |
| --- | --- |
| 列表上限改回 500px | `列表容器有 300px 上限…` **变红**（1 failed / 19 passed） |
| 说明改回原单行长句 | 3 条 **变红**（三行结构、转义换行、接入网关；3 failed / 17 passed） |
| 两项均还原 | 20 passed |

### 构建产物核对

```text
pnpm --filter @tnnevol/dsh-fnos run build
lib/style.css 中 max-height:300px                     → 1 处
lib/style.css 中 dsh-fnos-gateway-tip-content         → 1 处
lib/style.css 中授权列表规则含 500px                   → 0 处
```

### 验收条件对照

| 验收条件 | 证据 | 结果 |
| --- | --- | --- |
| FNOS-008-01-AC-05 | 契约测试 2 条（上限值 + 滚动归属），逐条反转验证；产物核对 | 通过 |
| FNOS-008-01-AC-06 | 契约测试 5 条（三行结构、示例、用途、专用类、不影响共用提示），反转验证 3 条变红 | 通过 |

## 命令与结果

```text
pnpm --filter @tnnevol/dsh-fnos run check      # 28 files, 179 tests 全部通过
pnpm --filter @tnnevol/dsh-fnos run build      # 产物核对见上
pnpm exec eslint plugins/dsh-fnos-plugin       # 0 errors（11 个既有 warning 在未改动文件）
pnpm exec vitepress build docs                  # 通过
git diff --check                                # 干净
```

## 未完成部分

- **无运行时渲染证据**：本机 `web` profile 的 bundle 列表不含 `@tnnevol/dsh-fnos`
  （它是 fnOS 侧插件，由应用安装时注入），因此无法用运行中实例抓取 bundle 复核。
  浮层内 `pre-line` 的实际排版效果（三行断点、320px 上限下的折行）**未做人眼走查**。
- 300px 是按实机截图判断的取值，**未做运行时几何测量**（如列表首屏可见行数）；
  本记录不主张任何布局数值。
- 真实 fnOS NAS 与目标发行环境未验收；本记录只覆盖源码、契约测试与构建产物。
- 未改动 fnOS 网关侧的转发实现——本次只调整说明文案与列表上限，转发语义未变。

## 回滚

还原 `max-height` 为 500px、恢复 `gatewayProxyDescription` 原单行长句、移除
`DshTooltip` 的 `className` 与 `.dsh-fnos-gateway-tip-content` 规则即可；不涉及
数据、凭据或持久化状态。
