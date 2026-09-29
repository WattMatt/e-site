'use client'
/** Download helpers. No innerHTML: SVG is serialised with XMLSerializer and drawn to a canvas. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const vb = svg.viewBox.baseVal
  const w = vb && vb.width ? vb.width : svg.clientWidth || 800
  const h = vb && vb.height ? vb.height : svg.clientHeight || 300
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const src = new XMLSerializer().serializeToString(clone)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvasToPng(canvas)
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png failed'))), 'image/png'))
}

/** PNG of the first chart (svg, else canvas) inside `container`. */
export async function downloadChartPng(container: HTMLElement, filename: string): Promise<void> {
  const svg = container.querySelector('svg[data-chart]') as SVGSVGElement | null
  if (svg) return downloadBlob(await svgToPng(svg), filename)
  const canvas = container.querySelector('canvas') as HTMLCanvasElement | null
  if (canvas) return downloadBlob(await canvasToPng(canvas), filename)
}
