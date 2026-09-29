import { describe, expect, it } from 'vitest'
import { normalizeGatewayProxyPaths, validateGatewayProxyPaths } from '../../src/contracts/gateway-proxy-contract.ts'
import { gatewayProxyPathsFile } from '../../src/host/gateway-proxy-routes.ts'

describe('fnOS gateway proxy configuration', () => {
  it('normalizes a full submitted snapshot', () => {
    expect(normalizeGatewayProxyPaths({ version: 1, paths: ['/store/', ' /alpha ', '/store'] })).toEqual(['/alpha', '/store'])
  })
  it('removes invalid and reserved paths', () => {
    expect(normalizeGatewayProxyPaths({ version: 1, paths: ['/api/x', '/plugins/x', '/__fnos-gateway/x', '//host', '/a/../b', '/a%2fb'] })).toEqual([])
  })
  it('rejects a submitted snapshot containing an invalid path', () => {
    expect(validateGatewayProxyPaths({ version: 1, paths: ['/valid/path', 'not-an-absolute-path'] })).toBeUndefined()
    expect(validateGatewayProxyPaths({ version: 1, paths: ['/api/private'] })).toBeUndefined()
  })
  it('accepts normalized absolute path prefixes and blank lines', () => {
    expect(validateGatewayProxyPaths({ version: 1, paths: ['/store/', ' ', '/alpha'] })).toEqual(['/alpha', '/store'])
  })
  it('writes under the persistent fnOS package variable directory', () => {
    expect(gatewayProxyPathsFile({ TRIM_PKGVAR: '/vol4/@appdata/fn-deepseek-harness' } as NodeJS.ProcessEnv)).toBe('/vol4/@appdata/fn-deepseek-harness/gateway/path-allowlist.json')
  })

  // The plugin writes the file the gateway parses, so both sides must agree on
  // every document-shaped input. The gateway refuses a missing or unsupported
  // `version`; accepting one here would let the plugin rewrite a foreign
  // document as `version: 1` and drop paths it did not understand.
  it('accepts the versioned document and the bare settings-field array', () => {
    expect(normalizeGatewayProxyPaths({ version: 1, paths: ['/store/'] })).toEqual(['/store'])
    // `gatewayProxyPaths` is declared `string[]`, so the settings mirror and the
    // GET route read the field value directly, without a document wrapper.
    expect(normalizeGatewayProxyPaths(['/store/'])).toEqual(['/store'])
  })

  it('refuses a document without a supported version instead of coercing it', () => {
    expect(normalizeGatewayProxyPaths({ version: 2, paths: ['/store'] })).toBeUndefined()
    expect(normalizeGatewayProxyPaths({ version: '1', paths: ['/store'] })).toBeUndefined()
    expect(normalizeGatewayProxyPaths({ paths: ['/store'] })).toBeUndefined()
    expect(normalizeGatewayProxyPaths({})).toBeUndefined()
    expect(validateGatewayProxyPaths({ version: 2, paths: ['/store'] })).toBeUndefined()
  })
})
