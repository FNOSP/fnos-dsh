# @tnnevol/dsh-e2e-kit

本仓库 Midscene Test 交互测试的共享装配层。

## 为什么需要它

FNOS-013 在真实环境里踩出三件事，各测试项目都要用、也最容易各踩一遍，因此集中在这里：

| 能力 | 解决的问题 |
| --- | --- |
| `defineBridgeSetup()` | 用 Bridge Mode 接入**用户真实 Chrome**（窗口可见、复用登录态、无钥匙串弹窗、视口正确），并处理接入配置、标签页复用与收尾 |
| `loadBridgeEnv()` | 接入配置向 `@tnnevol/dsh-midscene` 插件获取：零密钥、端口自动探测（桥被占用会跳号） |
| `actUntil()` | 交互后**独立核实**、未生效重试——Midscene 单次点击可能不生效而 `ai()` 仍自述成功 |

## 用法

```ts
// midscene.config.ts
import { defineTestProject } from '@midscene/test/config'
import { createMidsceneNodes } from '@midscene/test/midscene'
import { AgentOverChromeBridge } from '@midscene/web/bridge-mode'
import { defineBridgeSetup, type BridgeContext } from '@tnnevol/dsh-e2e-kit'

export default defineTestProject<BridgeContext>({
  projects: [{
    name: 'dsh-web',
    setup: defineBridgeSetup({ targetUrl: process.env.DSH_WEB_URL ?? '' }),
    nodes: createMidsceneNodes<BridgeContext>({
      agentClass: AgentOverChromeBridge,
      getAgent: ({ context }) => context.agent,
    }),
    files: { include: ['cases/**/*.yaml'] },
  }],
})
```

运行前需满足：

1. DSH 正在运行且 `@tnnevol/dsh-midscene` 插件已启用（提供模型与接入配置）；
2. Chrome 已安装 Midscene 扩展（Bridge Mode 的客户端），首次连接时在弹窗点 Allow。

## 约定（与测试规范一致）

- **模型配置在 Node 侧**：Bridge Mode 的硬性要求；本包自动从插件取，无需手工维护。
- **标签页纪律**：先查后复用（同源同路径视为同一页）、收尾保留目标页、只关闭本次新建的页。
- **交互必须独立核实**：不采信 `ai()` 自述。
