import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SettingsForms from '@deepseek-ai/dsh-settings'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fnosPlugin from '../../src/index.ts'

/**
 * Integration proof that the `dsh-fnos` settings namespace is configurable.
 *
 * Root cause this pins: the Host module exported only a TypeScript
 * `interface Config` for the `dsh-fnos` entry. `@deepseek-ai/dsh-settings`
 * resolves a namespace's schema from `entry.fiber.runtime.Config`, so with a
 * type-only declaration it rejected every write with
 * `No configurable plugin entry "dsh-fnos"`. `@deepseek-ai/dsh-host-webserver`
 * converts that escaping rejection into an empty-body **400**, which is what
 * the browser reported for
 * `PUT /app/fn-deepseek-harness/plugins/dsh-fnos/gateway/proxy-paths`.
 *
 * This drives the REAL `SettingsForms` service — only `configEditor` and
 * `profileContext` are stand-ins, because they need a full Loader — so it fails
 * again if the runtime schema stops being exported or stops being volatile.
 */

/** The two services SettingsForms injects, backed by one in-memory patch. */
function settingsHarness(root: Context, home: string) {
  const writes: Array<Record<string, unknown>> = []
  let stored: Record<string, unknown> = {}
  const entry = {
    id: 'dsh-fnos',
    options: { id: 'dsh-fnos', name: '@tnnevol/dsh-fnos', config: {} as Record<string, unknown> },
    fiber: undefined as unknown,
  }
  root.provide('profileContext', {
    name: 'e2e',
    dir: home,
    home,
    installAnchor: home,
    patchPath: join(home, 'package.json'),
  })
  // SettingsForms schedules a post-Loader legacy-import pass at construction.
  // This harness has no Loader, so only the awaited hook has to exist.
  root.provide('loader', { await: async () => undefined })
  // The plugin registers Web routes at apply; this test only cares that the
  // settings entry resolves, so the routes are captured and discarded.
  const routes: unknown[] = []
  root.provide('webServer', {
    register: (route: unknown) => { routes.push(route); return () => undefined },
    registerUpgrade: () => () => undefined,
    tapIndex: () => () => undefined,
  })
  void routes
  root.provide('configEditor', {
    documentPath: join(home, 'package.json'),
    entries: () => [entry],
    configuration: () => [{ entry, inherited: {}, override: structuredClone(stored) }],
    edit: async (
      target: { fiber?: { runtime?: unknown }, options: { config: Record<string, unknown> } },
      change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      // Mirrors the real editor: derive the next raw config, persist it, then
      // let describe() read it back through the entry.
      const next = change(structuredClone(stored), {})
      // The real ConfigEditor also validates through the owning runtime's
      // schema, which is why an out-of-domain value must be refused here too.
      const runtime = target.fiber?.runtime as { Config?: unknown } | undefined
      const schema = runtime?.Config as { ['~standard']?: { validate: (value: unknown) => unknown } } | undefined
      const result = schema?.['~standard']?.validate(next) as { issues?: unknown } | undefined
      if (result !== undefined && 'issues' in result) {
        throw new Error(`Config validation failed: ${JSON.stringify(result.issues)}`)
      }
      writes.push(next)
      stored = structuredClone(next)
      target.options.config = structuredClone(stored)
    },
  })
  return { entry, writes, stored: () => stored }
}

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-fnos-settings-'))
  await writeFile(join(home, 'package.json'), `${JSON.stringify({ name: 'e2e-profile', private: true }, null, 2)}\n`)
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

/** Boot the plugin for real so its fiber carries the exported runtime schema. */
async function bootPlugin(root: Context, entry: { fiber: unknown }) {
  // `inject: []` because provider availability is what the test controls; the
  // declared list is exercised by the plugin's own composition.
  const plugin = {
    name: '@tnnevol/dsh-fnos',
    apply: fnosPlugin.apply,
    inject: [] as string[],
    Config: fnosPlugin.Config,
  }
  const fiber = root.plugin(plugin, {})
  await fiber
  entry.fiber = fiber
  return fiber
}

/** One fully-wired context: harness services, real SettingsForms, live plugin. */
async function bootSettings() {
  const root = new Context()
  const harness = settingsHarness(root, home)
  // `SettingsForms extends Service`, so its constructor registers the
  // "settings" service on this context by itself.
  const settings: SettingsForms = new SettingsForms(root)
  const fiber = await bootPlugin(root, harness.entry)
  return { root, harness, settings, fiber }
}

describe('dsh-fnos settings service integration', () => {
  it('exposes a configurable dsh-fnos entry and accepts the gateway proxy path write', async () => {
    const { harness, settings, fiber } = await bootSettings()

    const described = settings.describe()
    const descriptor = described.find(row => row.ns === 'dsh-fnos')
    // Without a runtime Config this list is empty and update() rejects.
    expect(described.map(row => row.ns)).toContain('dsh-fnos')
    expect(descriptor?.value).toBeDefined()

    // The exact call the failing HTTP route performs.
    await settings.update('dsh-fnos', { gatewayProxyPaths: ['/store/api', '/alpha'] })
    expect(harness.stored().gatewayProxyPaths).toEqual(['/store/api', '/alpha'])

    await fiber.dispose()
  })

  it('accepts the theme cache write and refuses an out-of-domain theme', async () => {
    const { harness, settings, fiber } = await bootSettings()

    await settings.update('dsh-fnos', { systemTheme: 'dark' })
    expect(harness.stored().systemTheme).toBe('dark')

    await expect(settings.update('dsh-fnos', { systemTheme: 'blue' })).rejects.toBeDefined()

    await fiber.dispose()
  })

  it('keeps the earlier paths when a later theme write merges into the patch', async () => {
    const { harness, settings, fiber } = await bootSettings()

    await settings.update('dsh-fnos', { gatewayProxyPaths: ['/store/api'] })
    await settings.update('dsh-fnos', { systemTheme: 'light' })

    // Both volatile fields share one section; a theme write must not drop paths.
    expect(harness.stored().gatewayProxyPaths).toEqual(['/store/api'])
    expect(harness.stored().systemTheme).toBe('light')

    await fiber.dispose()
  })
})
