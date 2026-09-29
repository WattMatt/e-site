import { describe, it, expect } from 'vitest'
import { metresPerPixel, mapboxStaticUrl, SATELLITE_CAPTURE, MAPBOX_ATTRIBUTION, clampSatelliteZoom } from './satellite'

describe('satellite capture maths (D-08)', () => {
  it('equator, zoom 0, standard resolution', () => {
    expect(metresPerPixel(0, 0, false)).toBeCloseTo(78271.517, 3)
  })
  it('Johannesburg, zoom 19, @2x (hand-checked)', () => {
    expect(metresPerPixel(-26.2, 19, true)).toBeCloseTo(0.0669763, 7)
  })
  it('the capture is 1280 × 1280 @2x = 2560 px, north up', () => {
    expect(SATELLITE_CAPTURE).toMatchObject({ width: 1280, height: 1280, retina: true, defaultZoom: 19 })
    expect(SATELLITE_CAPTURE.pixelSize).toBe(2560)
  })
  it('clamps the zoom to what the capture allows', () => {
    expect(clampSatelliteZoom(25)).toBe(20)
    expect(clampSatelliteZoom(3)).toBe(16)
    expect(clampSatelliteZoom(18.6)).toBe(19)
  })
  it('builds the static-image URL with bearing 0, pitch 0 and the token encoded', () => {
    expect(mapboxStaticUrl({ lat: -26.2, lng: 28.05, zoom: 19, token: 'pk.a/b' })).toBe(
      'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/28.05,-26.2,19,0,0/1280x1280@2x?access_token=pk.a%2Fb&attribution=true&logo=true',
    )
  })
  it('attribution text is WinAnsi-printable (© is 0xA9)', () => {
    expect(MAPBOX_ATTRIBUTION).toBe('© Mapbox © OpenStreetMap © Maxar')
  })
})
