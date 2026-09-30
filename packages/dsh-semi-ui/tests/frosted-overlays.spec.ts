import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Regression guard for the frosted menu surfaces.
 *
 * DSH 0.2.0-rc.2 changed `--dsw-specific-menu` from `--dsw-alias-bg-layer-3`
 * (opaque) to `--dsw-menu-surface-fill`, which is translucent —
 * `#f8f9fa94` in light (`#f8f9faf0` on darwin) and `#43454a73` in dark. Any
 * surface that paints this token without a backdrop filter lets the content
 * behind it show through. The official `HoverCard` pairs the token with
 * `--dsw-menu-backdrop-filter` (`blur(40px) saturate(150%)`); this package must
 * do the same for its bubble-like overlays.
 *
 * The assertions read the **built** `lib/style.css`, not the Sass source: the
 * `-webkit-` prefix in particular is dropped by the CSS minifier unless it sits
 * in its own rule, so asserting on `src/theme.scss` would pass while the
 * shipped stylesheet silently lost the declaration.
 */

const STYLE_CSS = readFileSync(resolve(import.meta.dirname, '../lib/style.css'), 'utf8')
const THEME_SCSS = readFileSync(resolve(import.meta.dirname, '../src/theme.scss'), 'utf8')

/** Extract one rule body from the minified stylesheet by its exact selector text. */
function ruleBody(selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`(?:^|[},])\\s*${escaped}\\{([^{}]*)\\}`, 'u').exec(STYLE_CSS)
  return match?.[1]
}

describe('frosted overlay surfaces', () => {
  it('paints the popover with the DSH menu token', () => {
    const body = ruleBody('body[data-dsh-semi-theme] .semi-popover-wrapper')
    expect(body).toBeDefined()
    expect(body).toContain('background:var(--dsw-specific-menu)')
  })

  it('gives the popover the official menu backdrop filter', () => {
    const body = ruleBody('body[data-dsh-semi-theme] .semi-popover-wrapper')
    // Unprefixed form for Safari 18+ and every other current engine.
    expect(body).toContain('backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%))')
  })

  it('keeps the -webkit- prefix in the emitted stylesheet for older Safari', () => {
    // caniuse `css-backdrop-filter` marks Safari 15.6-17.6 as `y x`: supported
    // only behind the prefix. The minifier drops the prefixed declaration when
    // it shares a block with the standard one, so it must be emitted separately.
    expect(STYLE_CSS).toMatch(/-webkit-backdrop-filter:var\(--dsw-menu-backdrop-filter,blur\(40px\) saturate\(150%\)\)/)
    expect(STYLE_CSS).toMatch(/@supports[^{]*\(-webkit-backdrop-filter/)
  })

  it('keeps the -webkit- declaration out of the shared block in source', () => {
    // Guard the trap directly: the two declarations must not be siblings, or
    // the build silently discards the prefixed one. Extract only the brace
    // body, so trailing comments that mention the prefix do not count.
    const start = THEME_SCSS.indexOf('body[data-dsh-semi-theme] .semi-popover-wrapper {')
    const open = THEME_SCSS.indexOf('{', start)
    const sharedBlock = THEME_SCSS.slice(open, THEME_SCSS.indexOf('}', open))
    expect(sharedBlock).toContain('backdrop-filter: var(--dsw-menu-backdrop-filter')
    expect(sharedBlock).not.toContain('-webkit-backdrop-filter')
  })

  it('falls back to a concrete blur so a missing token still frosts', () => {
    // The token is defined on `body` by @deepseek-ai/dsh-client-ui-theme; the
    // fallback keeps the effect if that stylesheet loads after this one or a
    // future DSH removes the token.
    const body = ruleBody('body[data-dsh-semi-theme] .semi-popover-wrapper')
    expect(body).toContain('blur(40px) saturate(150%)')
  })
})
