import { describe, expect, it } from 'vitest'
import { normalizeProxyPaths } from '../src/server/path-allowlist.ts'
import { normalizeGatewayProxyPaths } from '../../../plugins/dsh-fnos-plugin/src/contracts/gateway-proxy-contract.ts'

describe('gateway API URL proxy paths', () => {
  it('normalizes, de-duplicates and sorts custom absolute paths', () => {
    expect(normalizeProxyPaths({ version: 1, paths: ['/store/api/', ' /alpha ', '/store/api'] })).toEqual(['/alpha', '/store/api'])
  })
  it('keeps built-in routes out of user configuration', () => {
    expect(normalizeProxyPaths({ version: 1, paths: ['/api/private', '/plugins/x', '/', 'relative'] })).toEqual([])
  })
  it('rejects a damaged document without replacing the active snapshot', () => {
    expect(normalizeProxyPaths({ version: 2, paths: ['/x'] })).toBeUndefined()
    expect(normalizeProxyPaths({ version: 1, paths: 'bad' })).toBeUndefined()
  })

  /**
   * The plugin writes the file the gateway parses, so both normalizers must
   * agree on every **document** input. They drifted once: the gateway refused
   * an unsupported `version` while the plugin ignored the field, so a document
   * one side rejected could still be rewritten by the other as `version: 1`.
   *
   * Every case below is an object (the document shape) and must be accepted or
   * refused identically. The bare-array settings-field shape is intentionally
   * asymmetric and is asserted separately.
   */
  it('agrees with the plugin normalizer on every document-shaped input', () => {
    const cases: unknown[] = [
      { version: 1, paths: ['/store/api', ' /alpha '] },
      { version: 1, paths: ['/store/', '/store'] },
      { version: 1, paths: [] },
      { version: 1, paths: ['/', '//host', 'relative', '/a/../b', '/a%2fb', '/api/x', '/plugins/x', '/__fnos-gateway/x'] },
      { version: 1, paths: ['/ok', 'not-absolute'] },
      { version: 1, paths: ['/a?b', '/a#b', '/a\0b'] },
      { version: 1, paths: ['/a/./b', '/a/../b'] },
      { version: 1, paths: 'bad' },
      { version: 1 },
      { version: 2, paths: ['/x'] },
      { version: '1', paths: ['/x'] },
      { version: 1.0, paths: ['/x'] },
      { paths: ['/x'] },
      {},
      undefined,
      null,
      'nope',
      42,
    ]

    for (const value of cases) {
      const gateway = normalizeProxyPaths(value)
      const plugin = normalizeGatewayProxyPaths(value)
      expect(plugin, `plugin verdict for ${JSON.stringify(value)}`).toEqual(gateway)
    }
  })

  /**
   * The plugin alone also normalizes the **settings-field** shape.
   *
   * `gatewayProxyPaths` is declared `string[]`, so the settings mirror and the
   * GET route hand the plugin a bare array. The gateway never sees that shape —
   * it only ever reads the on-disk document — so this asymmetry is deliberate
   * rather than drift.
   */
  it('accepts the bare settings array that only the plugin normalizes', () => {
    expect(normalizeGatewayProxyPaths(['/store/'])).toEqual(['/store'])
    expect(normalizeGatewayProxyPaths([])).toEqual([])
    expect(normalizeProxyPaths(['/store/'])).toBeUndefined()
  })
})
