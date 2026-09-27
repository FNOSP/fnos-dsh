import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('dsh-fnos DSH 0.1.7 settings migration', () => {
  it('uses SettingsForms on Host and does not use removed settings APIs', async () => {
    const host = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8')
    const routes = await readFile(new URL('../../src/host/gateway-proxy-routes.ts', import.meta.url), 'utf8')

    expect(host).toContain('ctx.settings.describe()')
    expect(host).not.toContain('ctx.settings.register')
    expect(host).not.toContain('ctx.settings.get')
    expect(routes).toContain('settings.describe()')
    expect(routes).toContain('settings.update(')
    expect(routes).not.toContain('SettingsScope')
  })

  it('uses ConfigForms and the current settings slot on Client', async () => {
    const client = await readFile(new URL('../../src/client/index.ts', import.meta.url), 'utf8')
    const persistence = await readFile(new URL('../../src/client/services/theme-persistence.ts', import.meta.url), 'utf8')

    expect(client).toContain('configForms')
    expect(client).toContain('settings.plugins.tab')
    expect(client).not.toContain('settingsScope')
    expect(client).not.toContain('settings.plugin.item')
    expect(persistence).not.toContain('SettingsScope')
  })
})
