/*! @license
 * Portions ported from pvlib-python (pvlib/spa.py), BSD 3-Clause License:
 *
 * Copyright (c) 2023 pvlib python Contributors
 * Copyright (c) 2014 PVLIB python Development Team
 * Copyright (c) 2013 Sandia National Laboratories
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 *   Redistributions of source code must retain the above copyright notice, this
 *   list of conditions and the following disclaimer.
 *
 *   Redistributions in binary form must reproduce the above copyright notice, this
 *   list of conditions and the following disclaimer in the documentation and/or
 *   other materials provided with the distribution.
 *
 *   Neither the name of the copyright holder nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
/**
 * NREL Solar Position Algorithm (Reda & Andreas 2004, NREL/TP-560-34302), accuracy ±0.0003°.
 * Ported from pvlib-python `pvlib/spa.py` (BSD-3-Clause) — see spa-tables.ts for the pinned
 * commit and licence notice. NOT derived from NREL's own C source (which carries its own licence).
 *
 * Azimuth convention matches engine spec §3.2: degrees clockwise from true north.
 */
import { B0, B1, L0, L1, L2, L3, L4, L5, NUTATION_ABCD, NUTATION_Y, R0, R1, R2, R3, R4 } from './spa-tables'

export interface SolarPosition {
  /** Topocentric zenith incl. refraction, degrees. */
  zenith: number
  /** Topocentric azimuth, degrees clockwise from north. */
  azimuth: number
  /** 90 − zenith. */
  elevation: number
}

export interface SpaOptions {
  /** Observer elevation, m. */
  elevationM: number
  /** Local pressure, hPa (refraction). */
  pressureHpa: number
  /** Local air temperature, °C (refraction). */
  temperatureC: number
  /** TT − UT1, seconds. 69 s is representative of 2020–2026. */
  deltaT?: number
  /** Atmospheric refraction at sunrise/sunset, degrees. */
  atmosRefract?: number
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const mod360 = (x: number) => ((x % 360) + 360) % 360

function series(table: readonly (readonly number[])[], x: number): number {
  let s = 0
  for (const r of table) s += r[0]! * Math.cos(r[1]! + r[2]! * x)
  return s
}

export function solarPosition(unixMs: number, latDeg: number, lonDeg: number, o: SpaOptions): SolarPosition {
  const deltaT = o.deltaT ?? 69
  const atmosRefract = o.atmosRefract ?? 0.5667

  const jd = unixMs / 86_400_000 + 2440587.5
  const jde = jd + deltaT / 86400
  const jc = (jd - 2451545) / 36525
  const jce = (jde - 2451545) / 36525
  const jme = jce / 10

  const L = mod360(
    deg(
      (series(L0, jme) + series(L1, jme) * jme + series(L2, jme) * jme ** 2 + series(L3, jme) * jme ** 3 +
        series(L4, jme) * jme ** 4 + series(L5, jme) * jme ** 5) / 1e8,
    ),
  )
  const B = deg((series(B0, jme) + series(B1, jme) * jme) / 1e8)
  const R =
    (series(R0, jme) + series(R1, jme) * jme + series(R2, jme) * jme ** 2 + series(R3, jme) * jme ** 3 +
      series(R4, jme) * jme ** 4) / 1e8

  const theta = mod360(L + 180)
  const beta = -B

  const x0 = 297.85036 + 445267.11148 * jce - 0.0019142 * jce ** 2 + jce ** 3 / 189474
  const x1 = 357.52772 + 35999.05034 * jce - 0.0001603 * jce ** 2 - jce ** 3 / 300000
  const x2 = 134.96298 + 477198.867398 * jce + 0.0086972 * jce ** 2 + jce ** 3 / 56250
  const x3 = 93.27191 + 483202.017538 * jce - 0.0036825 * jce ** 2 + jce ** 3 / 327270
  const x4 = 125.04452 - 1934.136261 * jce + 0.0020708 * jce ** 2 + jce ** 3 / 450000

  let dPsiSum = 0
  let dEpsSum = 0
  for (let i = 0; i < NUTATION_Y.length; i++) {
    const y = NUTATION_Y[i]!
    const c = NUTATION_ABCD[i]!
    const arg = rad(y[0]! * x0 + y[1]! * x1 + y[2]! * x2 + y[3]! * x3 + y[4]! * x4)
    dPsiSum += (c[0]! + c[1]! * jce) * Math.sin(arg)
    dEpsSum += (c[2]! + c[3]! * jce) * Math.cos(arg)
  }
  const dPsi = dPsiSum / 36_000_000
  const dEps = dEpsSum / 36_000_000

  const U = jme / 10
  const e0 =
    84381.448 - 4680.93 * U - 1.55 * U ** 2 + 1999.25 * U ** 3 - 51.38 * U ** 4 - 249.67 * U ** 5 -
    39.05 * U ** 6 + 7.12 * U ** 7 + 27.87 * U ** 8 + 5.79 * U ** 9 + 2.45 * U ** 10
  const eps = e0 / 3600 + dEps

  const dTau = -20.4898 / (3600 * R)
  const lambda = theta + dPsi + dTau

  const v0 = mod360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * jc ** 2 - jc ** 3 / 38710000)
  const v = v0 + dPsi * Math.cos(rad(eps))

  const alpha = mod360(
    deg(Math.atan2(Math.sin(rad(lambda)) * Math.cos(rad(eps)) - Math.tan(rad(beta)) * Math.sin(rad(eps)), Math.cos(rad(lambda)))),
  )
  const delta = deg(
    Math.asin(Math.sin(rad(beta)) * Math.cos(rad(eps)) + Math.cos(rad(beta)) * Math.sin(rad(eps)) * Math.sin(rad(lambda))),
  )

  const H = mod360(v + lonDeg - alpha)
  const xi = 8.794 / (3600 * R)
  const u = Math.atan(0.99664719 * Math.tan(rad(latDeg)))
  const x = Math.cos(u) + (o.elevationM / 6378140) * Math.cos(rad(latDeg))
  const y = 0.99664719 * Math.sin(u) + (o.elevationM / 6378140) * Math.sin(rad(latDeg))

  const dAlpha = deg(
    Math.atan2(-x * Math.sin(rad(xi)) * Math.sin(rad(H)), Math.cos(rad(delta)) - x * Math.sin(rad(xi)) * Math.cos(rad(H))),
  )
  const deltaP = deg(
    Math.atan2(
      (Math.sin(rad(delta)) - y * Math.sin(rad(xi))) * Math.cos(rad(dAlpha)),
      Math.cos(rad(delta)) - x * Math.sin(rad(xi)) * Math.cos(rad(H)),
    ),
  )
  const Hp = H - dAlpha

  const e0Topo = deg(
    Math.asin(Math.sin(rad(latDeg)) * Math.sin(rad(deltaP)) + Math.cos(rad(latDeg)) * Math.cos(rad(deltaP)) * Math.cos(rad(Hp))),
  )
  const dE =
    e0Topo >= -1 * (0.26667 + atmosRefract)
      ? (o.pressureHpa / 1010) * (283 / (273 + o.temperatureC)) * (1.02 / (60 * Math.tan(rad(e0Topo + 10.3 / (e0Topo + 5.11)))))
      : 0
  const elevation = e0Topo + dE
  const gamma = mod360(
    deg(Math.atan2(Math.sin(rad(Hp)), Math.cos(rad(Hp)) * Math.sin(rad(latDeg)) - Math.tan(rad(deltaP)) * Math.cos(rad(latDeg)))),
  )
  return { zenith: 90 - elevation, azimuth: mod360(gamma + 180), elevation }
}
