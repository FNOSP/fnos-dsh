import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { PathAllowlistStore } from '../src/server/path-allowlist.ts'

/**
 * HARDENING CONTRACT (not a reproduction of a reported failure).
 *
 * `PathAllowlistStore.reload()` invokes every subscriber synchronously, and the
 * file watcher calls it as `void this.reload()` from `fs.watch`'s callback. Any
 * rejection there is therefore **unhandled**, and `cli.ts` treats one as fatal
 * (`process.once('unhandledRejection', … shutdown(1))`), restarting the gateway
 * and dropping every in-flight request plus the DSH Web child.
 *
 * I could NOT construct a subscriber that throws today: the single production
 * subscriber writes to an SSE response and already guards `res.destroyed` and
 * `res.writableEnded`, and `res.write()` after `destroy()` does not throw
 * synchronously under Node 24 (verified — it surfaces as an async
 * `ERR_STREAM_WRITE_AFTER_END` error event, which the route already handles).
 * So this is defense in depth: one future subscriber bug, anywhere, would
 * otherwise escalate from "one broken stream" to "gateway restart".
 *
 * The contract pinned here: a throwing listener is isolated and removed, every
 * healthy listener still receives the update, and `reload()` resolves.
 */
describe('path allowlist store listener isolation', () => {
  const cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanup.length > 0) await cleanup.pop()?.()
  })

  async function store(initialPaths: string[]) {
    const directory = await mkdtemp(join(tmpdir(), 'fnos-allowlist-store-'))
    cleanup.push(async () => rm(directory, { recursive: true, force: true }))
    const filePath = join(directory, 'path-allowlist.json')
    await writeFile(filePath, `${JSON.stringify({ version: 1, paths: initialPaths })}\n`)
    const instance = new PathAllowlistStore(filePath)
    await instance.reload()
    cleanup.push(async () => instance.close())
    return { instance, filePath }
  }

  it('resolves reload even when a subscriber throws', async () => {
    const { instance, filePath } = await store(['/first'])
    instance.subscribe(() => { throw new Error('subscriber blew up') })

    await writeFile(filePath, `${JSON.stringify({ version: 1, paths: ['/second'] })}\n`)

    // Before isolation this rejected, becoming an unhandled rejection in the
    // watcher path and terminating the gateway.
    await expect(instance.reload()).resolves.toBe(true)
  })

  it('still updates every healthy subscriber when one throws', async () => {
    const { instance, filePath } = await store(['/first'])
    const seen: string[][] = []
    instance.subscribe(() => { throw new Error('subscriber blew up') })
    instance.subscribe(snapshot => { seen.push([...snapshot.paths]) })

    await writeFile(filePath, `${JSON.stringify({ version: 1, paths: ['/second'] })}\n`)
    await instance.reload()

    expect(seen.at(-1)).toEqual(['/second'])
  })

  it('isolates a throwing subscriber at subscribe time as well', async () => {
    const { instance } = await store(['/first'])
    // `subscribe` pushes the current snapshot immediately, so a listener that
    // throws on its first call must not break the caller.
    expect(() => instance.subscribe(() => { throw new Error('first-call failure') })).not.toThrow()
  })

  it('keeps the last good snapshot readable after a subscriber fails', async () => {
    const { instance, filePath } = await store(['/first'])
    instance.subscribe(() => { throw new Error('subscriber blew up') })
    await writeFile(filePath, `${JSON.stringify({ version: 1, paths: ['/second'] })}\n`)
    await instance.reload()
    expect(instance.snapshot().paths).toEqual(['/second'])
  })

  it('removes the failing subscriber so later reloads stay quiet', async () => {
    const { instance, filePath } = await store(['/first'])
    let attempts = 0
    instance.subscribe(() => { attempts += 1; throw new Error('subscriber blew up') })
    // The initial push plus one reload must not keep retrying a broken listener.
    await writeFile(filePath, `${JSON.stringify({ version: 1, paths: ['/second'] })}\n`)
    await instance.reload()
    await writeFile(filePath, `${JSON.stringify({ version: 1, paths: ['/third'] })}\n`)
    await instance.reload()
    expect(attempts).toBe(1)
  })
})
