/**
 * Satellite roof capture (functional spec §3.2 C, decision D-08: keep Mapbox).
 *
 * The server fetches ONE Static Images API picture, north up (bearing 0, pitch
 * 0), stores it, and records metres-per-pixel from the tile maths below — so a
 * satellite roof source has a scale without calibration. Mapbox's attribution
 * and logo stay IN the image (attribution=true&logo=true) and the text is also
 * stored and printed on every exported sheet.
 */
export const EARTH_CIRCUMFERENCE_M = 40_075_016.686
export const MAPBOX_TILE_SIZE = 512

export const SATELLITE_CAPTURE = {
  style: 'mapbox/satellite-v9',
  width: 1280,
  height: 1280,
  retina: true,
  pixelSize: 2560,
  minZoom: 16,
  maxZoom: 20,
  defaultZoom: 19,
} as const

export const MAPBOX_ATTRIBUTION = '© Mapbox © OpenStreetMap © Maxar'

export function metresPerPixel(latDeg: number, zoom: number, retina: boolean): number {
  const mpp = (EARTH_CIRCUMFERENCE_M * Math.cos((latDeg * Math.PI) / 180)) / (MAPBOX_TILE_SIZE * 2 ** zoom)
  return retina ? mpp / 2 : mpp
}

export function clampSatelliteZoom(zoom: number): number {
  return Math.min(SATELLITE_CAPTURE.maxZoom, Math.max(SATELLITE_CAPTURE.minZoom, Math.round(zoom)))
}

export function mapboxStaticUrl(i: { lat: number; lng: number; zoom: number; token: string }): string {
  const c = SATELLITE_CAPTURE
  return `https://api.mapbox.com/styles/v1/${c.style}/static/${i.lng},${i.lat},${i.zoom},0,0/${c.width}x${c.height}${c.retina ? '@2x' : ''}` +
    `?access_token=${encodeURIComponent(i.token)}&attribution=true&logo=true`
}
