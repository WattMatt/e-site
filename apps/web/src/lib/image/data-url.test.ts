import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataUrlToBlob } from './data-url'

const blobBytes = (b: Blob) =>
  new Promise<number[]>((resolve) => { const r = new FileReader(); r.onload = () => resolve([...new Uint8Array(r.result as ArrayBuffer)]); r.readAsArrayBuffer(b) })

describe('dataUrlToBlob', () => {
  it('decodes a base64 PNG data URL without the network', async () => {
    const b = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=')
    expect(b.type).toBe('image/png')
    expect(await blobBytes(b)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })
  it('refuses anything that is not a data URL', () => {
    expect(() => dataUrlToBlob('https://example.com/x.png')).toThrow('Not a data URL')
  })
})

// The CSP connect-src does not allow data:, so fetch(dataUrl) fails in every browser. It broke
// signature saving and markup saving in production; this keeps the pattern out for good.
describe('no fetch() on a data URL anywhere in the app', () => {
  it('finds none', () => {
    const root = join(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          const code = line.trim()
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return
          if (/fetch\(\s*(dataUrl|dataURL|dataUri)\s*\)/.test(code)) hits.push(`${p.slice(root.length + 1)}:${i + 1}`)
        })
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
