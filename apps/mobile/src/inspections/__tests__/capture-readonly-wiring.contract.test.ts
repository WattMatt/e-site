// The capture screen and the field renderers are React Native components that
// this vitest setup does not render, so the wiring of the read-only lock is
// pinned at the source: forgetting to thread `readOnly` to one Renderer call
// site would hand the separate verifier an input the database refuses (00250).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const mobileRoot = join(__dirname, '..', '..', '..')
const screen = readFileSync(join(mobileRoot, 'app', 'inspections', '[inspectionId]', 'index.tsx'), 'utf8')
const renderers = readFileSync(join(mobileRoot, 'src', 'inspections', 'FieldRenderers.tsx'), 'utf8')

// Whole-line comments only: a naive block-comment strip would eat code after a
// string such as the MIME wildcard '*/*'.
const stripComments = (src: string) =>
  src
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')

// Every `<Renderer ... />` element, props included.
function rendererElements(src: string): string[] {
  return stripComments(src).match(/<Renderer\b[\s\S]*?\/>/g) ?? []
}

describe('separate-verifier lock wiring', () => {
  it('the capture screen decides editability with captureAccess (status AND separate verifier)', () => {
    const src = stripComments(screen)
    expect(src).toMatch(/captureAccess\(\{[\s\S]*verifierId:\s*inspection\.verifier_id/)
    expect(src).toMatch(/deliverableType/)
    expect(src).not.toMatch(/ANSWERABLE_STATUSES\.includes/)
  })

  it('Submit is offered only when captureAccess allows it', () => {
    const src = stripComments(screen)
    expect(src).toMatch(/\{canSubmit && \(\s*<TouchableOpacity/)
    expect(src).toMatch(/!access\?\.canSubmit\) return/)
  })

  it('answers are not queued from a read-only form', () => {
    expect(stripComments(screen)).toMatch(/if \(!inspectionId \|\| readOnly\) return/)
  })

  it('every Renderer call site on the screen and inside a repeating group passes readOnly', () => {
    const sites = [...rendererElements(screen), ...rendererElements(renderers)]
    expect(sites.length).toBeGreaterThanOrEqual(3)
    for (const el of sites) expect(el).toMatch(/\breadOnly=\{readOnly\}/)
  })

  it('the photo, signature and file slots keep their place and say they are empty when read-only', () => {
    const src = stripComments(renderers)
    expect(src).toContain("'No photo yet'")
    expect(src).toContain("'No photo'")
    expect(src).toContain("'Not signed yet'")
    expect(src).toContain("'No file yet'")
  })
})
