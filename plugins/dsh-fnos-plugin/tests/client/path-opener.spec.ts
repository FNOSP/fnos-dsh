import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFnosPathOpener, type PathOpenerSdk } from '../../src/client/services/path-opener.ts'
import { stubEmbeddedFnos, stubLocalDev, stubStandaloneFnos } from './fnos-env.ts'

afterEach(() => { vi.unstubAllGlobals() })

function sdk(options: Partial<PathOpenerSdk> = {}): PathOpenerSdk {
  return {
    isWeb: true,
    isStandaloneWeb: false,
    ready: async () => undefined,
    openFile: async () => undefined,
    ...options,
  }
}

describe('fnOS path opener', () => {
  it('opens an authorized path through the fnOS iframe bridge', async () => {
    // 必须伪造完整的内嵌环境：判据读 `<base>`，只有 `window.parent` 不够。
    stubEmbeddedFnos()
    const original: string[] = []
    const opened: string[] = []
    const workspaces = {
      openPath: async (path: string) => { original.push(path) },
    }
    const dispose = installFnosPathOpener(workspaces, {
      createSdk: () => sdk({ openFile: async path => { opened.push(path) } }),
    })

    await workspaces.openPath('/vol4/project/report.md')

    expect(opened).toEqual(['/vol4/project/report.md'])
    expect(original).toEqual([])
    dispose()
  })

  it('keeps the original DSH opener outside fnOS (local development)', async () => {
    /*
      回落原生只在「根本不在 fnOS 里」时成立。独立浏览器页面**是** fnOS 应用，
      回落会在 NAS 容器里跑 xdg-open——那里没有桌面环境，失败信息与真实原因无关。
    */
    stubLocalDev()
    const original: string[] = []
    const workspaces = {
      openPath: async (path: string) => { original.push(path) },
    }
    const dispose = installFnosPathOpener(workspaces, {
      createSdk: () => sdk({ isStandaloneWeb: true }),
    })

    await workspaces.openPath('/tmp/report.md')

    expect(original).toEqual(['/tmp/report.md'])
    dispose()
  })

  it('fails explicitly inside a standalone fnOS page instead of falling back to xdg-open', async () => {
    // standalone 属于 fnOS，但没有宿主桥：既要报错，也不能回落原生。
    stubStandaloneFnos()
    const original: string[] = []
    const workspaces = {
      openPath: async (path: string) => { original.push(path) },
    }
    const dispose = installFnosPathOpener(workspaces, {
      createSdk: () => sdk({ isStandaloneWeb: true }),
    })

    await expect(workspaces.openPath('/vol4/report.md')).rejects.toThrow(/fnOS/u)
    expect(original).toEqual([])
    dispose()
  })

  it('uses the fnOS bridge inside an iframe even when the SDK reports standalone', async () => {
    stubEmbeddedFnos()
    const original: string[] = []
    const opened: string[] = []
    {
      const workspaces = {
        openPath: async (path: string) => { original.push(path) },
      }
      const dispose = installFnosPathOpener(workspaces, {
        createSdk: () => sdk({
          isStandaloneWeb: true,
          openFile: async path => { opened.push(path) },
        }),
      })

      await workspaces.openPath('/vol4/project/report.md')

      expect(opened).toEqual(['/vol4/project/report.md'])
      expect(original).toEqual([])
      dispose()
    }
  })

  it('lets fnOS decide authorization instead of preflighting the plugin directory list', async () => {
    stubEmbeddedFnos()
    const original: string[] = []
    const opened: string[] = []
    const workspaces = {
      openPath: async (path: string) => { original.push(path) },
    }
    const dispose = installFnosPathOpener(workspaces, {
      createSdk: () => sdk({ openFile: async path => { opened.push(path) } }),
    })

    await workspaces.openPath('/vol4/private/report.md')
    expect(opened).toEqual(['/vol4/private/report.md'])
    expect(original).toEqual([])
    dispose()
    await workspaces.openPath('/vol4/private/report.md')
    expect(original).toEqual(['/vol4/private/report.md'])
  })

  it('converts fnOS bridge failures into a readable error', async () => {
    stubEmbeddedFnos()
    const workspaces = {
      openPath: async (_path: string) => undefined,
    }
    const dispose = installFnosPathOpener(workspaces, {
      createSdk: () => sdk({
        openFile: async () => { throw new Error('openFile unavailable') },
      }),
      message: () => '无法通过 fnOS 打开该路径',
    })

    await expect(workspaces.openPath('/vol4/share/report.md')).rejects.toThrow('无法通过 fnOS 打开该路径')
    dispose()
  })
})
