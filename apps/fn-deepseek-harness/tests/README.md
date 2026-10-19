# 应用级交互验收（`@tnnevol/fn-deepseek-harness-e2e`）

用 [Midscene Test](https://midscenejs.com/zh/midscene-test/configuration.html) 对
**应用产物**做端到端验收：FPK 在真实 NAS 上从「从电脑上传」装到装完、装完后应用是否
正常启动、内置插件是否真的被装载。

## 为什么单独成包

`apps/fn-deepseek-harness` 本身不是 workspace 包（它是要被 `fnpack` 打的应用目录），
而这里的验收跨插件——它验证的是**应用**而不是某个插件。因此按目录结构规范单列一个包，
放在 app 之下，职责是「验证该应用的产物」。

与插件内 `plugins/<插件>/tests/e2e/` 的分工：

| 位置 | 验证对象 |
| --- | --- |
| `plugins/<插件>/tests/e2e/` | 该插件自身功能（如药丸按钮的形态与状态） |
| **本包** | 应用产物（FPK 安装、应用启动、内置插件装载、凭据状态） |

## 运行

```bash
# 在包根执行（include 相对执行目录解析，务必在此目录下跑）
cd apps/fn-deepseek-harness/tests

# 只跑安全的只读验收（默认，排除 destructive 标签）
DSH_FPK_DIR="<只放 FPK 的最小目录>" pnpm run test:e2e

# 指定 NAS 地址（必填）
DSH_NAS_URL="http://<nas>:5666/" DSH_FPK_DIR=... pnpm run test:e2e
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DSH_FPK_DIR` | **是** | 待上传 FPK 所在目录。**只授权这一个最小目录**，不要给仓库根或家目录。 |
| `DSH_NAS_URL` | **是** | 被测 fnOS Web 地址，如 `http://<nas>:5666/`。不内置默认值——设备地址属于环境信息，不进仓库 |

### 前置条件

1. Chrome 已装 Midscene 扩展（`gbldofcpkknbggpkmbdaefngejllnief`），并已登录 NAS；
2. **NAS 页面已打开**——用例复用已开页，不新开（见测试规范的标签页纪律）；
3. 本机 DSH Web 在运行（提供 Midscene 桥；端口以 `GET /v1/health` 的 `port` 为准）。

运行时**静默执行**：不把 NAS 页面抢到前台（`defineBridgeSetup` 的 `activate` 默认
`false`）。需要人观察过程时，在配置里显式传 `activate: true`。

## 用例

| 用例 | 内容 | 是否写操作 |
| --- | --- | --- |
| `TC-100` | 应用详情页显示已安装版本与来源 | 只读 |
| `TC-101` | 应用介绍列出四个内置插件、且不声称内置 Midscene | 只读 |
| `TC-102` | 打开应用后 DSH 界面正常渲染 | 只读 |
| `TC-103` | DSH 客户端模块图装载四个内置插件 | 只读 |
| `TC-104` | 手动安装：从电脑上传 FPK 并完成覆盖安装 | **写操作（覆盖安装）** |

`TC-104` 带 `destructive` 标签，**不随套件默认执行**。单独跑：

```bash
DSH_FPK_DIR=... pnpm exec midscene-test --config e2e/midscene.config.ts \
  --project fnos-nas --tags destructive
```

用例编号与 `docs/tests/FNOS-013-midscene-browser-automation-bridge.md` 对齐：测试文档是
**权威台账**（登记结果与结论），YAML 是**执行载体**。

## 写这个 YAML 的三条硬约束

解析器很严格，违规会直接报 `WorkflowParseError`：

1. **字符串简写不能带 `options`**。`aiAct: 某提示` 会被映射成 `{ prompt }`，此时再并列
   `options:` 就是两个键，报 `step N must contain exactly one node`。要带选项必须写对象形态：

   ```yaml
   - aiAct:
       prompt: ...
       options:
         fileChooserAccept: ['${fpkDir}/app.fpk']
   ```

2. **每个 step 恰好一个动作**：不能一步里既 `aiTap` 又 `aiAssert`。
3. **参数名以 `midscene-test nodes <dir> --config <cfg>` 生成的说明书为准**，不要凭记忆写。
   例如 `aiWaitFor` 是 `strictObject{prompt, options{timeoutMs}}`——超时键是
   `options.timeoutMs` 而非顶层 `timeout`。

另外两条语义约束：

- `${name}` 是**项目变量**（缺失即报错），`${{NAME}}` 才是环境变量。`javascript` 步骤里
  不要写模板字面量（会被扫描插值）。
- 用例必须自己**建立起始状态**：有头浏览器复用真实页面，前序用例可能把界面留在任意位置。

## 上传文件的两条路径（别混）

读 `@midscene/core` 源码确认，两者独立：

| 路径 | 用法 | 是否需要 `fileChooserAllowedDir` |
| --- | --- | --- |
| **直接预设** | `aiAct` 的 `options.fileChooserAccept: ['<路径>']` → 内部 `register()` | 不需要（直接用给定路径） |
| **提示词驱动** | 提示词里让 AI 自行调用 `RegisterFileChooserAccept` 动作 → `registerFromAllowedDir()` | **需要**（校验路径不越界） |

本套用**路径①**，因此 `fileChooserAccept` 直接给 `${fpkDir}` 下的文件即可。
注意 `fileChooserAllowedDir` 属于 **`aiAct` 的选项**，不是 Agent 构造参数——构造时传会被
静默忽略（实测踩过）。

## 产物

- HTML 报告与截图：`midscene_run/`（git 忽略）
- 节点说明书：`midscene-node-spec.fnos-nas.md`（由 `pnpm exec midscene-test nodes` 生成，
  **不进仓库**）
