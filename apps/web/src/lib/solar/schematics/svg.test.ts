import { buildSchematicSvg } from './svg'

const base = {
  width: 800, height: 600, backgroundDataUrl: 'data:image/jpeg;base64,AAAA',
  cards: [{ meterId: 'A', x: 10, y: 20, w: 180, h: 64, colour: '#2563eb', label: 'Shop <12> & "Co"', sublabel: 'tenant · 12', included: true }],
  lines: [{ points: [100, 100, 200, 200], lineType: 'supply' as const }, { points: [0, 0, 5, 5], lineType: 'check' as const }],
  layers: { background: true, meters: true, lines: true },
}

describe('buildSchematicSvg', () => {
  it('embeds the background as a data URL (never a public URL) and escapes every label', () => {
    const svg = buildSchematicSvg(base)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('href="data:image/jpeg;base64,AAAA"')
    expect(svg).toContain('Shop &lt;12&gt; &amp; &quot;Co&quot;')
    expect(svg).not.toContain('<12>')
    expect(svg).toContain('stroke-dasharray')
  })
  it('honours the layer toggles', () => {
    const svg = buildSchematicSvg({ ...base, layers: { background: false, meters: true, lines: false } })
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('<polyline')
  })
  it('escapes the sublabel and never lets a colour break out of its attribute', () => {
    const svg = buildSchematicSvg({ ...base, cards: [{ ...base.cards[0], colour: '"/><script>x</script>', sublabel: "O'Neil </text><script>" }] })
    expect(svg).not.toContain('<script')
    expect(svg).toContain('O&#39;Neil &lt;/text&gt;&lt;script&gt;')
    expect(svg).toContain('stroke="#2563eb"')
  })
  it('refuses a non-data background URL', () => {
    expect(() => buildSchematicSvg({ ...base, backgroundDataUrl: 'https://x/y.png' })).toThrow(/data URL/)
  })
})
