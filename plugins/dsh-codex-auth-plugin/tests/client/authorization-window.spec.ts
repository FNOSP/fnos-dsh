import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const SECTION = new URL('../../src/components/CodexAuthSection.tsx', import.meta.url)
const PATHS = new URL('../../src/contracts/auth-paths.ts', import.meta.url)

describe('Codex 授权窗口导航', () => {
  it('在请求 device code 前直接打开固定的 OpenAI 授权页，不先展示空白页', async () => {
    const source = await readFile(SECTION, 'utf8')
    const paths = await readFile(PATHS, 'utf8')

    expect(paths).toContain("CODEX_AUTH_VERIFICATION_URI = 'https://auth.openai.com/codex/device'")
    expect(source).toContain('CODEX_AUTH_VERIFICATION_URI')
    expect(source).toContain("window.open(CODEX_AUTH_VERIFICATION_URI, '_blank')")
    expect(source).not.toContain("window.open('about:blank', '_blank')")
    expect(source).not.toContain('popup.location.replace(next.verificationUri)')

    const catchStart = source.indexOf('    } catch (error: unknown) {', source.indexOf('const signIn = async'))
    const finallyStart = source.indexOf('    } finally {', catchStart)
    expect(catchStart).toBeGreaterThan(-1)
    expect(finallyStart).toBeGreaterThan(catchStart)
    expect(source.slice(catchStart, finallyStart)).not.toContain('popup.close()')
  })
})
