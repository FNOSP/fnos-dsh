import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PROJECT_BASE_VERSION,
  assertProjectBaseVersion,
  formatProjectVersion,
  nextProjectVersion,
  parseProjectVersion,
  readDshBaselineFromCatalog,
} from '../src/core/project-version.js'

const BASELINE = '0.2.1-rc.2'

describe('parseProjectVersion：版本拆解（FNOS-019-01）', () => {
  it('TC-001 拆出基础版本、基线与迭代号三段', () => {
    // 基线自带预发布段（`rc.2` 里也有 `.`），边界只能从尾部定位，不能按 `-` 切。
    expect(parseProjectVersion('5.9.0-0.2.1-rc.2.5')).toEqual({
      base: '5.9.0',
      baseline: BASELINE,
      iteration: 5,
    })
  })

  it('TC-002 迭代号为 0 与多位时不按字符截断', () => {
    expect(parseProjectVersion('5.9.0-0.2.1-rc.2.0')?.iteration).toBe(0)
    expect(parseProjectVersion('5.9.0-0.2.1-rc.2.10')?.iteration).toBe(10)
  })

  it('TC-003 先拆后装能还原原串', () => {
    for (const version of ['5.9.0-0.2.1-rc.2.0', '5.9.0-0.2.1-rc.2.7', '5.9.0-0.2.1-rc.2.10']) {
      const parts = parseProjectVersion(version)
      expect(parts).toBeDefined()
      expect(formatProjectVersion(parts!)).toBe(version)
    }
  })

  it('TC-004 不合规输入返回未解析而非抛异常', () => {
    // 返回 undefined 而不是抛错：调用方需要据此决定是报错还是「当作首版」。
    for (const version of ['5.9.0', '5.9.0-abc', '5.9.0-0.2.1-rc.2.x', '']) {
      expect(parseProjectVersion(version)).toBeUndefined()
    }
  })

  it('TC-005 给出已知基线时，缺迭代号的串按第 0 次迭代处理', () => {
    // `5.9.0-0.2.1-rc.2` 有两读：基线 `0.2.1-rc.2`（缺迭代号）或基线 `0.2.1-rc` + 迭代号 2。
    // 已知基线时必须判为前者，否则下次会算出 .3 而凭空跳号。
    expect(parseProjectVersion('5.9.0-0.2.1-rc.2', BASELINE)).toEqual({
      base: '5.9.0',
      baseline: BASELINE,
      iteration: 0,
    })
  })

  it('TC-005 已知基线与串内基线不符时不被强行匹配', () => {
    const parsed = parseProjectVersion('5.9.0-0.2.2-rc.1.6', BASELINE)
    expect(parsed?.baseline).toBe('0.2.2-rc.1')
    expect(parsed?.iteration).toBe(6)
  })

  it('允许 `v` 前缀，输出归一化到基础段', () => {
    expect(parseProjectVersion('v5.9.0-0.2.1-rc.2.5')?.base).toBe('5.9.0')
  })
})

describe('nextProjectVersion：下次版本计算（FNOS-019-02）', () => {
  it('TC-009 常规递增只动末尾迭代号', () => {
    expect(nextProjectVersion('5.9.0-0.2.1-rc.2.5', BASELINE)).toBe('5.9.0-0.2.1-rc.2.6')
  })

  it('TC-010 无当前版本时从第 0 次迭代起算', () => {
    expect(nextProjectVersion(undefined, BASELINE)).toBe('5.9.0-0.2.1-rc.2.0')
  })

  it('TC-011 基线变化时迭代号继续递增而不是归零', () => {
    // 归零会让新号的排序退回旧位置，设备会判为降级而拒绝安装。
    expect(nextProjectVersion('5.9.0-0.2.1-rc.2.5', '0.2.2-rc.1')).toBe('5.9.0-0.2.2-rc.1.6')
  })

  it('TC-012 缺迭代号的当前版本不被误读成迭代号 2', () => {
    expect(nextProjectVersion('5.9.0-0.2.1-rc.2', BASELINE)).toBe('5.9.0-0.2.1-rc.2.1')
  })

  it('基础版本段恒为固定值', () => {
    const next = nextProjectVersion('1.2.3-0.2.1-rc.2.5', BASELINE)
    expect(next.startsWith(`${PROJECT_BASE_VERSION}-`)).toBe(true)
  })

  it('非法基线直接报错，不产出可疑版本号', () => {
    expect(() => nextProjectVersion('5.9.0-0.2.1-rc.2.5', 'not-a-version')).toThrow(/baseline/iu)
  })
})

describe('readDshBaselineFromCatalog：基线唯一来源（FNOS-019-04）', () => {
  it('TC-006 从真实的 pnpm-workspace.yaml 读出基线', () => {
    const yaml = readFileSync(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    expect(readDshBaselineFromCatalog(yaml)).toBe(BASELINE)
  })

  it('TC-007 不把 catalog 分组内的子包当作基线', () => {
    // 分组（`dsh:`）下的键是子包名，若误取会得到子包版本而不是运行时基线。
    const yaml = ['catalog:', `  '@deepseek-ai/dsh': ${BASELINE}`, '  dsh:', "    '@deepseek-ai/dsh-agent': 9.9.9", ''].join('\n')
    expect(readDshBaselineFromCatalog(yaml)).toBe(BASELINE)
  })

  it('TC-008 未声明基线时返回 undefined 交由调用方报错', () => {
    expect(readDshBaselineFromCatalog('catalog:\n  foo: 1.0.0\n')).toBeUndefined()
  })

  it('声明了非法值时不返回可疑基线', () => {
    expect(readDshBaselineFromCatalog("catalog:\n  '@deepseek-ai/dsh': latest\n")).toBeUndefined()
  })
})

describe('assertProjectBaseVersion：基础段静态不动（AC-01）', () => {
  it('TC-015 基础段不是固定值时明确报错而不是静默改写', () => {
    expect(() => assertProjectBaseVersion('5.9.1-0.2.1-rc.2.5', BASELINE)).toThrow(/5\.9\.0/u)
  })

  it('基础段正确时返回拆解结果', () => {
    expect(assertProjectBaseVersion('5.9.0-0.2.1-rc.2.5', BASELINE).iteration).toBe(5)
  })

  it('不符合三段形态时给出可操作的错误', () => {
    expect(() => assertProjectBaseVersion('5.9.0', BASELINE)).toThrow(/FNOS-019/u)
  })
})
