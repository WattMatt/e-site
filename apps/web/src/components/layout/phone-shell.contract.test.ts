/**
 * Contract: the phone shell is switched by CSS alone, and the one place JS
 * needs the breakpoint (usePhoneViewport, which only gates network reads) uses
 * the SAME query. Read from the real stylesheet so a drift in either fails.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { PHONE_QUERY } from '@/lib/mobile/use-phone-viewport'

const css = readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8')

/** The body of the first `@media <query> { … }` block, brace-matched. */
function mediaBlock(query: string): string | null {
  const start = css.indexOf(`@media ${query} {`)
  if (start === -1) return null
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1)
  }
  return null
}

describe('phone shell CSS contract', () => {
  const block = mediaBlock(PHONE_QUERY)

  it('globals.css has a media block for exactly the query usePhoneViewport uses', () => {
    expect(block).not.toBeNull()
  })

  it('hides the sidebar and shows the tab bar only inside that block', () => {
    expect(block).toMatch(/\.sidebar\s*\{\s*display:\s*none;/)
    expect(block).toMatch(/\.mobile-tabbar\s*\{[^}]*display:\s*grid;/)
    // Outside the block, the phone pieces default to hidden.
    const outside = css.replace(block ?? '', '')
    expect(outside).toMatch(/\.mobile-tabbar,\s*\n?\.mobile-project-bar\s*\{\s*display:\s*none;\s*\}/)
  })

  it('is screen-only, so a printed page (≈680 px wide) never gets the phone layout', () => {
    expect(PHONE_QUERY.startsWith('screen and ')).toBe(true)
  })

  it('keeps tab-bar and sheet controls at a ≥44 px touch target', () => {
    expect(block).toMatch(/\.mobile-tab\s*\{[^}]*min-height:\s*56px;/)
    expect(css).toMatch(/\.bottom-sheet-close\s*\{[^}]*width:\s*44px;\s*height:\s*44px;/)
    expect(css).toMatch(/\.sheet-row\s*\{[^}]*min-height:\s*56px;/)
  })

  it('animates sheets with opacity only (a transform offsets Safari hit-testing, PR #150)', () => {
    const kf = css.match(/@keyframes sheetFade\s*\{[^}]*\}[^}]*\}/)?.[0] ?? ''
    expect(kf).toContain('opacity')
    expect(kf).not.toContain('transform')
  })
})
