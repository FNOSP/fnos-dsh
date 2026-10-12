/**
 * FNOS-012 交互用例的 Midscene Test 项目配置（Bridge Mode）。
 *
 * 用共享包 @tnnevol/dsh-e2e-kit 装配 —— 接入配置向插件要、标签页先查后复用、
 * 交互独立核实，全部由共享包承担，本配置只声明「跑哪些用例、连哪个地址」。
 */
import { defineTestProject } from '@midscene/test/config'
import { createMidsceneNodes } from '@midscene/test/midscene'
import { AgentOverChromeBridge } from '@midscene/web/bridge-mode'
import { defineBridgeSetup, type BridgeContext } from '@tnnevol/dsh-e2e-kit'

const targetUrl = process.env.DSH_WEB_URL
if (targetUrl === undefined || targetUrl === '') {
  throw new Error('缺少 DSH_WEB_URL：请传入带 token 的完整地址，例如 http://127.0.0.1:8070/?token=…')
}

export default defineTestProject<BridgeContext>({
  projects: [
    {
      name: 'dsh-web',
      setup: defineBridgeSetup({ targetUrl }),
      nodes: createMidsceneNodes<BridgeContext>({
        agentClass: AgentOverChromeBridge,
        getAgent: ({ context }) => context.agent,
      }),
      // 注意：include 相对**执行目录**（插件根）解析，不是相对本配置文件。
      files: { include: ['tests/e2e/cases/**/*.yaml'] },
    },
  ],
  test: {
    // 交互用例串行执行：同一浏览器窗口里并行操作会互相干扰。
    maxConcurrency: 1,
    testTimeout: 180_000,
  },
  output: { reportDir: './midscene_run/report' },
})
