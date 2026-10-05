'use client'
/**
 * Area-of-supply map (E7). MapLibre on open tiles (OpenFreeMap, no key; D2).
 * If the tile style cannot load, the municipalities still draw on a plain
 * background. Colour = supply status of the municipality's own licensee;
 * clicking a municipality names it and links to its tariffs.
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { SUPPLY_STATUS_LABELS, type AreaSupply, type SupplyStatus } from '@esite/shared'

// Validated (dataviz validate_palette --pairs all, light): blue/amber/teal; grey = no licensee.
export const STATUS_COLOUR: Record<SupplyStatus, string> = {
  published: '#2563eb',
  in_review: '#d97706',
  no_tariffs: '#0d9488',
  no_licensee: '#94a3b8',
}
const TILE_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const BLANK_STYLE = { version: 8 as const, sources: {}, layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#eef0f3' } }] }

type GeoJSONData = Parameters<import('maplibre-gl').Map['addSource']>[1] extends { data?: infer D } ? D : never

interface Picked { code: string; name: string; province: string; supply: AreaSupply }

export function SupplyMap({ supply }: { supply: Record<string, AreaSupply> }) {
  const el = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tilesOk, setTilesOk] = useState(true)

  useEffect(() => {
    let map: import('maplibre-gl').Map | null = null
    let cancelled = false
    ;(async () => {
      try {
        const [{ default: maplibregl }, res] = await Promise.all([import('maplibre-gl'), fetch('/api/tariffs/municipalities')])
        if (!res.ok) throw new Error(`boundaries ${res.status}`)
        const geo = await res.json() as { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: unknown; properties: Record<string, unknown> | null }> }
        for (const f of geo.features) {
          const code = String(f.properties?.code ?? '').toUpperCase()
          f.properties = { ...f.properties, status: supply[code]?.status ?? 'no_licensee' }
        }
        if (cancelled || !el.current) return
        let style: string | typeof BLANK_STYLE = TILE_STYLE
        try {
          const probe = await fetch(TILE_STYLE, { method: 'GET' })
          if (!probe.ok) throw new Error('tiles')
        } catch {
          style = BLANK_STYLE
          setTilesOk(false)
        }
        map = new maplibregl.Map({ container: el.current, style, bounds: [[16.3, -35.0], [33.0, -22.0]], attributionControl: { compact: true, customAttribution: 'Boundaries: Municipal Demarcation Board (2021), simplified' } })
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
        map.on('load', () => {
          if (!map) return
          map.addSource('munis', { type: 'geojson', data: geo as unknown as GeoJSONData })
          map.addLayer({ id: 'munis-fill', type: 'fill', source: 'munis', paint: {
            'fill-color': ['match', ['get', 'status'], 'published', STATUS_COLOUR.published, 'in_review', STATUS_COLOUR.in_review, 'no_tariffs', STATUS_COLOUR.no_tariffs, STATUS_COLOUR.no_licensee],
            'fill-opacity': 0.55,
          } })
          map.addLayer({ id: 'munis-line', type: 'line', source: 'munis', paint: { 'line-color': '#ffffff', 'line-width': 1 } })
          map.on('click', 'munis-fill', (e) => {
            const p = e.features?.[0]?.properties as { code?: string; name?: string; province?: string } | undefined
            if (!p?.code) return
            const code = p.code.toUpperCase()
            setPicked({ code, name: String(p.name ?? code), province: String(p.province ?? ''), supply: supply[code] ?? { status: 'no_licensee', licensee: null } })
          })
          map.on('mouseenter', 'munis-fill', () => { if (map) map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', 'munis-fill', () => { if (map) map.getCanvas().style.cursor = '' })
          setState('ready')
        })
        map.on('error', (e) => console.error('[tariff-explorer] map error', { message: String((e as { error?: Error }).error?.message ?? 'unknown').slice(0, 120) }))
      } catch (e) {
        console.error('[tariff-explorer] map failed', { message: e instanceof Error ? e.message.slice(0, 120) : 'unknown' })
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true; map?.remove() }
  }, [supply])

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div role="note" style={{ fontSize: 12, padding: '8px 10px', border: '1px solid var(--c-border)', borderRadius: 6 }}>
        Each municipality is coloured by what its own distribution licensee has published. <strong>Eskom also supplies parts of most municipalities directly</strong> (often rural and township areas), so a coloured municipality does not mean every address in it buys from the municipality. Check the account holder&apos;s bill.
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }} aria-label="Legend">
        {(Object.keys(STATUS_COLOUR) as SupplyStatus[]).map((s) => (
          <span key={s}><span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, background: STATUS_COLOUR[s], marginRight: 6, borderRadius: 2 }} />{SUPPLY_STATUS_LABELS[s]}</span>
        ))}
      </div>
      {state === 'error' && <p role="alert" style={{ fontSize: 13 }}>The map could not load. Reload the page, or find the supply authority in the Explorer tab.</p>}
      <div style={{ position: 'relative' }}>
        <div ref={el} style={{ width: '100%', height: 560, borderRadius: 8, overflow: 'hidden', background: '#eef0f3' }} aria-label="Map of municipal areas of supply" role="region" />
        {state === 'loading' && <p style={{ position: 'absolute', top: 12, left: 12, fontSize: 13, margin: 0 }}>Loading the map…</p>}
      </div>
      {!tilesOk && <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: 0 }}>The background map tiles are unavailable; municipal boundaries are drawn without them.</p>}
      {picked && (
        <div aria-live="polite" style={{ fontSize: 13, padding: '8px 10px', border: '1px solid var(--c-border)', borderRadius: 6 }}>
          <strong>{picked.name}</strong> ({picked.code}{picked.province ? `, ${picked.province}` : ''}) · {SUPPLY_STATUS_LABELS[picked.supply.status]}
          {picked.supply.licensee
            ? <> · <Link href={`/tariffs/${picked.supply.licensee.id}`}>{picked.supply.licensee.name} tariffs</Link></>
            : <> · <Link href="/tariffs">Look up Eskom&apos;s tariffs in the Explorer</Link></>}
        </div>
      )}
    </div>
  )
}
