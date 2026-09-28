# Solar Phase 4a-i — Calculation Engine: Weather, Solar Geometry, PV Model, PVGIS Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first half of the E-Site Solar calculation engine as pure TypeScript — PVGIS TMY parsing, the UTC→SAST 8760 reference year, NREL SPA solar position, Perez 1990 / Hay–Davies transposition, ASHRAE IAM, NOCT/Faiman cell temperature, the multiplicative loss chain, inverter efficiency and clipping, string-sizing checks, the hourly PV simulation with its KPIs, and reproducibility primitives — proven within ±3 % of PVGIS at 5 South African sites × 3 orientations, with regression guards that make WM Solar's static curve and WM's un-shifted UTC weather fail.

**Architecture:** A new directory `packages/shared/src/services/solar/` holds small single-purpose modules with no I/O, exported through a package subpath `@esite/shared/solar-engine` (not the root barrel). Weather enters as a parsed PVGIS response and leaves as a `WeatherYear` of 8,760 SAST hours; the PV model consumes it and returns interval-mean hourly series plus annual KPIs. Validation fixtures are verbatim PVGIS responses (gzipped, SHA-256 pinned) and reference yields recorded at planning time with their exact queries.

**Tech Stack:** TypeScript 5.9 (strict), Vitest 2.1, pnpm + Turborepo. No new npm dependencies. Node 22+ only for the two fixture/table generator scripts.

**Spec:** `docs/solar/02-calculation-engine-spec.md` §1, §3.2–§3.7, §7 (implement exactly, deviations listed below). Decisions: `docs/solar/06-open-decisions.md` (D-11, D-19).
**Companion plan:** `docs/superpowers/plans/2026-09-28-solar-phase-4a-engine-ii-balance-finance.md` (battery, energy balance, finance) runs on the SAME branch after this one.
**Out of scope:** §3.1 array auto-fill/packing (Phase 5), §3.5 near-shading horizon from drawn obstructions [D-11] (Phase 5 — obstructions come from Layout; until then the fixed shading-loss input applies), §2 load model (Phase 3), §5 bill engine (Phase 2a), PVGIS fetch + cache route (Phase 4b), any migration (case/run tables arrive with the 4b UI).

---

## Decisions taken in this plan (read before Task 1)

1. **Location: `packages/shared/src/services/solar/`** (not `src/solar-engine/`). The spec (§ header) and the development plan (P4) both name `services/solar`; the package's existing pure calculation services (`cable-calc.service.ts`, `mv-fault-calc.service.ts`) live under `services/`; and `src/solar/` (Phase 1a) holds Solar *domain* types (access levels), not computation. The engine is exported through a new subpath **`@esite/shared/solar-engine`** and is deliberately **not** added to `src/services/index.ts` / the root barrel: its generic names (`npv`, `irr`, `sum`, `HOURS_PER_YEAR`) would pollute the namespace every web and mobile file imports, and the mobile bundle has no use for it.
2. **SHA-256 is pure TypeScript** (`hash.ts`), not `node:crypto` or Web Crypto — the same `inputs_hash` must be produced synchronously on the server, in the browser and in React Native. It is tested against `node:crypto` over 201 strings including multi-byte UTF-8 and every block boundary.
3. **Solar position at the irradiance SAMPLE instant, then re-centred.** PVGIS stamps each TMY row `HH:00 UTC` and reports `irradiance_time_offset` (0.039–0.053 h at our sites): the irradiance was sampled at HH:00 + offset. The engine places the sun at that instant (as PVGIS itself does), computes POA and power there, then linearly re-centres every output series onto the hour midpoint so that `pAc[h]` is the mean over [h, h+1) like every other engine series. Spec §3.4 says "at the hour midpoint"; evaluating the sun at the midpoint against irradiance sampled ~27 min earlier mis-pairs geometry and irradiance (worst at sunrise/sunset and on east/west arrays). Re-centring is circular and weight-preserving, so **annual energy is identical** either way. → **Open question Q1.**
4. **What the ±3 % gate compares against.** Spec §3.7 says "within ±3 % of PVGIS PVcalc". Found at planning: PVcalc's `E_y` is the **2005–2020 long-term mean**, while the engine runs on the **TMY** (spec §3.4). Durban's TMY GHI is **3.7 % below** its 16-year mean, so engine-vs-PVcalc is −4.4 / −3.9 / −3.1 % for Durban even though the engine agrees with PVGIS's own PV model **within +1.6 % on the same weather**. The gate therefore compares against **PVGIS's PV model (`seriescalc`, `pvcalculation=1` — the same model PVcalc runs) summed over exactly the months the TMY drew from each year** — same weather, so only the model is tested. The PVcalc long-term values the brief asked for are recorded too (exact queries in `__fixtures__/pvgis.ts`) and checked at ±5 %. → **Open question Q2.**
5. **Identical loss inputs.** Engine: spec §7 defaults with near-shading 0 (PVGIS's `usehorizon=1` handles the horizon) and a flat 97.5 % inverter. PVGIS: `loss = 1 − 0.98·0.99·0.985·0.985·0.975·0.99·0.99 = 10.05 %`. Module: γ_Pmax −0.35 %/°C, NOCT 45 °C, ASHRAE b0 0.05 (typical c-Si datasheet values — **not tuned** to the reference).
6. **Licences — no GPL anywhere.** SPA: algorithm ported from pvlib-python `pvlib/spa.py` (BSD-3-Clause); its periodic-term tables are generated from that file at a **pinned commit** by a checked-in script. NOT derived from NREL's own C source (which carries NREL's own non-OSI licence). Perez 1990 coefficients: the published table, as tabulated in pvlib `irradiance.py` (BSD-3-Clause). PVGIS data © European Union, reusable with acknowledgement (Commission Decision 2011/833/EU). Attribution is in the file headers.
7. **IAM on diffuse and ground light.** Spec §3.4 gives the ASHRAE formula for the beam AOI. Diffuse and ground-reflected components get the same formula at the Brandemuehl & Beckman equivalent incidence angles (Duffie & Beckman eq. 5.4.1–2), which is what PVGIS does with its own reflection model. Without it the engine reads ~2 % high (mutation-verified at planning: removing beam IAM alone fails the gate).

### Planning-time validation result (prototype of exactly this plan's code, run 2026-09-28)

Engine = specific yield, kWh/kWp/yr. TMY-months = the gate reference. PVcalc = long-term E_y.

| Site | Orientation | Engine | TMY-months ref | Δ (gate ±3 %) | PVcalc E_y | Δ (check ±5 %) |
|---|---|---|---|---|---|---|
| Johannesburg | north 30° | 1838.5 | 1821.02 | +0.96 % | 1835.61 | +0.16 % |
| Johannesburg | north 15° | 1786.7 | 1767.87 | +1.07 % | 1786.17 | +0.03 % |
| Johannesburg | east–west 10° | 1624.7 | 1605.22 | +1.21 % | 1626.55 | −0.11 % |
| Pretoria | north 30° | 1786.4 | 1756.05 | +1.73 % | 1815.17 | −1.58 % |
| Pretoria | north 15° | 1747.5 | 1716.61 | +1.80 % | 1767.89 | −1.15 % |
| Pretoria | east–west 10° | 1604.1 | 1576.02 | +1.78 % | 1614.35 | −0.63 % |
| Cape Town | north 30° | 1740.4 | 1732.35 | +0.46 % | 1761.11 | −1.18 % |
| Cape Town | north 15° | 1698.0 | 1692.90 | +0.30 % | 1716.09 | −1.05 % |
| Cape Town | east–west 10° | 1552.0 | 1547.77 | +0.27 % | 1563.45 | −0.73 % |
| Durban | north 30° | 1489.2 | 1466.71 | +1.53 % | 1558.08 | **−4.42 %** |
| Durban | north 15° | 1446.3 | 1424.39 | +1.54 % | 1505.02 | **−3.90 %** |
| Durban | east–west 10° | 1317.2 | 1296.88 | +1.57 % | 1359.97 | **−3.14 %** |
| Upington | north 30° | 1954.0 | 1939.11 | +0.77 % | 1979.65 | −1.30 % |
| Upington | north 15° | 1904.0 | 1887.79 | +0.86 % | 1925.61 | −1.12 % |
| Upington | east–west 10° | 1736.1 | 1716.99 | +1.11 % | 1749.11 | −0.74 % |

WM Solar's static 2,346 kWh/kWp is +21.0 % to +80.9 % off the gate reference — fails all 15. Weather used in UTC without the +2 h shift (WM's bug): −3.6 % to −8.3 % — fails all 15. The whole 4a-i suite (66 tests + the 1-test barrel check) plus 4a-ii (64) ran green against the prototype; `tsc` clean; each gate was mutation-checked (dropping the +2 h shift, additive losses, dropping beam IAM, dropping re-centring — each turns a named test red).

---

## Ground rules

- Repo root for every path below is the worktree created in Task 1: `~/.config/superpowers/worktrees/esite/solar-phase-4a`.
- Run one test file: `pnpm --filter @esite/shared exec vitest run <path relative to packages/shared>`.
- **No migration in Phase 4a.** Do not touch `apps/edge-functions/supabase/migrations/`.
- Three suites before claiming done (CLAUDE.md): `pnpm --filter @esite/shared test`, `pnpm --filter web test`, `pnpm --filter @esite/db test:ci`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never "fix" a failing validation case by tuning a module parameter. A red gate is reported, not massaged.
- The two generator scripts need network (raw.githubusercontent.com, re.jrc.ec.europa.eu). If either is unreachable at execution, STOP and report — do not hand-type tables or fixtures.

## File structure

```
packages/shared/
  package.json                                   MODIFY  add "./solar-engine" export
  tsconfig.json                                  MODIFY  exclude src/**/__fixtures__/**
  scripts/solar/gen-spa-tables.mjs               CREATE  pvlib spa.py (pinned) → spa-tables.ts
  scripts/solar/fetch-pvgis-fixtures.mjs         CREATE  PVGIS TMY → gz fixtures (+ --references)
  src/services/solar/
    index.ts                                     CREATE  barrel for @esite/shared/solar-engine
    index.test.ts                                CREATE
    version.ts                                   CREATE  ENGINE_VERSION
    hash.ts / hash.test.ts                       CREATE  sha256Hex, canonicalJson, inputsHash
    time.ts / time.test.ts                       CREATE  8760 SAST time base
    weather/pvgis-tmy.ts (+ .test.ts)            CREATE  PVGIS TMY JSON + CSV parser
    weather/reference-year.ts (+ .test.ts)       CREATE  drop 29 Feb, order, UTC→SAST, WeatherYear
    solar-position/spa-tables.ts                 GENERATED by gen-spa-tables.mjs
    solar-position/spa.ts (+ .test.ts)           CREATE  NREL SPA
    irradiance/transposition.ts                  CREATE  AOI, ETR, air mass, Perez, Hay–Davies, ground, beam
    irradiance/iam.ts                            CREATE  ASHRAE IAM + equivalent angles
    irradiance/transposition.test.ts             CREATE  (covers both)
    pv/cell-temperature.ts                       CREATE  NOCT / Faiman
    pv/losses.ts                                 CREATE  multiplicative DC chain, AC factor, §7 loss defaults
    pv/inverter.ts                               CREATE  efficiency curve + clipping
    pv/components.test.ts                        CREATE  (covers the three above)
    pv/string-sizing.ts (+ .test.ts)             CREATE  §3.3 checks + recommended n
    pv/simulate-pv.ts (+ .test.ts)               CREATE  hourly PV + KPIs
    __fixtures__/pvgis.ts                        CREATE  loader, pinned SHAs, reference yields
    __fixtures__/pvgis/tmy_{jhb,pta,cpt,dbn,upt}.csv.gz   GENERATED by fetch-pvgis-fixtures.mjs
    pvgis-validation.test.ts                     CREATE  the §3.7 gate + regression guards
```

---

### Task 1: Worktree, branch and baseline

**Files:** none

- [ ] **Step 1: Create the worktree from the Phase 1a branch**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite"
git fetch origin -q
git worktree add -b feat/solar-phase-4a ~/.config/superpowers/worktrees/esite/solar-phase-4a origin/feat/solar-phase-1a
cd ~/.config/superpowers/worktrees/esite/solar-phase-4a
pnpm install --frozen-lockfile
```
Expected: worktree created on `feat/solar-phase-4a`, install completes.

- [ ] **Step 2: Baseline the suites and the type-check**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-4a
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter @esite/shared type-check 2>&1 | tail -3
```
Expected: all pass. Write the three test counts down — they go in the PR body. If anything is red on the untouched branch, STOP and report; do not build on a red baseline.

---

### Task 2: Package wiring, engine version, barrel

**Files:**
- Modify: `packages/shared/package.json` (the `exports` block)
- Modify: `packages/shared/tsconfig.json` (the `exclude` array)
- Create: `packages/shared/src/services/solar/version.ts`
- Create: `packages/shared/src/services/solar/index.ts`
- Test: `packages/shared/src/services/solar/index.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import * as engine from './index'

describe('@esite/shared/solar-engine barrel', () => {
  it('exposes a semver ENGINE_VERSION', () => {
    expect(engine.ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/index.test.ts`
Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/version.ts`:
```ts
/**
 * Engine version (spec §1.3): semver, bumped on ANY formula change. Every stored run records it.
 * `engine-golden.test.ts` pins exact outputs of a fixed case to this version: when a formula
 * changes those numbers move, and the test tells you to bump this constant with the new values.
 */
export const ENGINE_VERSION = '0.1.0'
```

`packages/shared/src/services/solar/index.ts`:
```ts
// E-Site Solar calculation engine — pure TypeScript, no I/O (engine spec §1).
// Imported as `@esite/shared/solar-engine`; deliberately NOT re-exported from the package root.
export * from './version'
```

In `packages/shared/package.json`, add one line to `exports` so the block reads:
```json
  "exports": {
    ".": "./src/index.ts",
    "./placeholder-fill": "./src/lib/jbcc/placeholder-fill.ts",
    "./docx-letterhead": "./src/lib/jbcc/docx-letterhead.ts",
    "./docx-preview": "./src/lib/jbcc/docx-html.ts",
    "./solar-engine": "./src/services/solar/index.ts"
  },
```

In `packages/shared/tsconfig.json`, replace the `exclude` line with (fixtures read files with `node:fs`/`node:zlib`/`node:crypto`, and the package has no `@types/node`):
```json
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/**/__fixtures__/**"]
```

- [ ] **Step 4: Run the test and the type-check**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/index.test.ts && pnpm --filter @esite/shared type-check`
Expected: 1 passed; type-check exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/package.json packages/shared/tsconfig.json packages/shared/src/services/solar/version.ts packages/shared/src/services/solar/index.ts packages/shared/src/services/solar/index.test.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): package subpath, engine version, barrel

@esite/shared/solar-engine → src/services/solar/index.ts (not the root barrel).
Fixtures excluded from the package type-check.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Reproducibility primitives — canonical JSON and SHA-256

**Files:**
- Create: `packages/shared/src/services/solar/hash.ts`
- Test: `packages/shared/src/services/solar/hash.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/hash.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { canonicalJson, inputsHash, sha256Hex } from './hash'

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('agrees with node:crypto across block boundaries and multi-byte UTF-8', () => {
    const alphabet = 'aZ9 ,.{}"é€🙂Ω≤'
    for (let len = 0; len <= 200; len++) {
      let s = ''
      for (let i = 0; i < len; i++) s += alphabet[(i * 7 + len) % alphabet.length]
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
  })
})

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}')
  })

  it('writes typed arrays as plain arrays and -0 as 0', () => {
    expect(canonicalJson({ x: Float64Array.from([1.5, -0]) })).toBe('{"x":[1.5,0]}')
  })

  it('refuses NaN and Infinity instead of hashing them as null', () => {
    expect(() => canonicalJson({ a: [1, Number.NaN] })).toThrow(/non-finite number at \$\.a\[1\]/)
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/)
  })
})

describe('inputsHash', () => {
  it('is independent of key order and sensitive to any value', () => {
    const a = inputsHash({ kWp: 100, tilt: 30, load: Float64Array.from([1, 2]) })
    expect(inputsHash({ load: [1, 2], tilt: 30, kWp: 100 })).toBe(a)
    expect(inputsHash({ kWp: 100, tilt: 30.0001, load: [1, 2] })).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/hash.test.ts`
Expected: FAIL — `Failed to resolve import "./hash"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/hash.ts`:
```ts
/**
 * Reproducibility primitives (engine spec §1.3): canonical JSON and SHA-256.
 *
 * Pure TypeScript — no `node:crypto`, no Web Crypto — so the same hash is produced
 * synchronously on the server, in the browser and in React Native.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** SHA-256 of a UTF-8 string, lowercase hex. FIPS 180-4. */
export function sha256Hex(text: string): string {
  const msg = utf8(text)
  const bitLen = msg.length * 8
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6)
  padded.set(msg)
  padded[msg.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(padded.length - 4, bitLen >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, k = h[7]!
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (k + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      k = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + k) >>> 0
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

/**
 * Canonical JSON: object keys sorted (code-unit order), `undefined` members dropped, typed
 * arrays written as plain arrays, and non-finite numbers REFUSED — `JSON.stringify` would
 * silently turn NaN into `null`, and two different inputs would then share one hash.
 */
export function canonicalJson(value: unknown): string {
  return write(value, '$')
}

function write(v: unknown, path: string): string {
  if (v === null) return 'null'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`canonicalJson: non-finite number at ${path}`)
    return JSON.stringify(Object.is(v, -0) ? 0 : v)
  }
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v)
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    return write(Array.from(v as unknown as ArrayLike<number>), path)
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => write(x, `${path}[${i}]`)).join(',')}]`
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${write(obj[k], `${path}.${k}`)}`).join(',')}}`
  }
  throw new Error(`canonicalJson: unsupported ${typeof v} at ${path}`)
}

/** `inputs_hash` of engine spec §1.3. */
export function inputsHash(input: unknown): string {
  return sha256Hex(canonicalJson(input))
}
```

Append to `packages/shared/src/services/solar/index.ts`:
```ts
export * from './hash'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/hash.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/hash.ts packages/shared/src/services/solar/hash.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): canonical JSON + pure-TS SHA-256 for inputs_hash

Refuses NaN/Infinity rather than hashing them as null. Verified against
node:crypto across block boundaries and multi-byte UTF-8.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The 8760 SAST time base

**Files:**
- Create: `packages/shared/src/services/solar/time.ts`
- Test: `packages/shared/src/services/solar/time.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/time.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  HOURS_PER_YEAR,
  assert8760,
  dayOfYear0,
  monthHourRanges,
  monthOfHour,
  monthlySums,
  sastHourStartUtcMs,
} from './time'

describe('time base', () => {
  it('has 8760 hours split into the non-leap months', () => {
    const r = monthHourRanges()
    expect(r).toHaveLength(12)
    expect(r[0]).toEqual({ month: 1, start: 0, end: 744 })
    expect(r[1]).toEqual({ month: 2, start: 744, end: 1416 })
    expect(r[11]!.end).toBe(HOURS_PER_YEAR)
  })

  it('maps hour indices to months at the boundaries', () => {
    expect(monthOfHour(0)).toBe(1)
    expect(monthOfHour(743)).toBe(1)
    expect(monthOfHour(744)).toBe(2)
    expect(monthOfHour(1415)).toBe(2)
    expect(monthOfHour(1416)).toBe(3)
    expect(monthOfHour(8759)).toBe(12)
  })

  it('refuses 29 February and out-of-range dates', () => {
    expect(dayOfYear0(1, 1)).toBe(0)
    expect(dayOfYear0(3, 1)).toBe(59)
    expect(dayOfYear0(12, 31)).toBe(364)
    expect(() => dayOfYear0(2, 29)).toThrow(/day out of range/)
    expect(() => dayOfYear0(13, 1)).toThrow(/month out of range/)
  })

  it('hour 0 starts at 01 Jan 00:00 SAST = 31 Dec 22:00 UTC', () => {
    expect(sastHourStartUtcMs(0)).toBe(Date.UTC(2024, 11, 31, 22))
    expect(sastHourStartUtcMs(2)).toBe(Date.UTC(2025, 0, 1, 0))
  })

  it('sums an 8760 series by month and refuses any other length', () => {
    const ones = new Float64Array(HOURS_PER_YEAR).fill(1)
    expect(monthlySums(ones)).toEqual([744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744])
    expect(() => assert8760(new Float64Array(8784), 'load')).toThrow(/load must have 8760/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/time.test.ts`
Expected: FAIL — `Failed to resolve import "./time"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/time.ts`:
```ts
/**
 * Time base (engine spec §1.2, fixed): a reference year of 8,760 hours, no 29 February.
 * Hour index 0 = 01 Jan 00:00–01:00 SAST (UTC+2, no DST). Values are interval averages:
 * `x[h]` is the mean over [h, h+1).
 */

export const HOURS_PER_YEAR = 8760
export const SAST_OFFSET_HOURS = 2
/**
 * Calendar year used ONLY to place the sun (solar geometry). Any non-leap year gives the
 * same answer to well under 0.01° of declination; it is fixed so runs are reproducible.
 */
export const GEOMETRY_YEAR = 2025
export const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const MONTH_START_DAY: readonly number[] = DAYS_IN_MONTH.reduce<number[]>(
  (acc, _d, i) => (i === 0 ? [0] : [...acc, acc[i - 1]! + DAYS_IN_MONTH[i - 1]!]),
  [],
)

/** 0-based day of year (non-leap) for month 1–12 and day 1–31. */
export function dayOfYear0(month: number, day: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error(`month out of range: ${month}`)
  const dim = DAYS_IN_MONTH[month - 1]!
  if (!Number.isInteger(day) || day < 1 || day > dim) throw new Error(`day out of range: ${month}/${day}`)
  return MONTH_START_DAY[month - 1]! + day - 1
}

/** Month (1–12) of a SAST hour index. */
export function monthOfHour(h: number): number {
  const day = Math.floor(h / 24)
  let m = 0
  while (m < 11 && day >= MONTH_START_DAY[m + 1]!) m++
  return m + 1
}

/** [start, end) hour indices of each month, January first. */
export function monthHourRanges(): { month: number; start: number; end: number }[] {
  return DAYS_IN_MONTH.map((dim, i) => ({
    month: i + 1,
    start: MONTH_START_DAY[i]! * 24,
    end: (MONTH_START_DAY[i]! + dim) * 24,
  }))
}

/** UTC epoch ms at the START of SAST hour h in GEOMETRY_YEAR. */
export function sastHourStartUtcMs(h: number): number {
  return Date.UTC(GEOMETRY_YEAR, 0, 1) + (h - SAST_OFFSET_HOURS) * 3_600_000
}

/** Sum an 8760 series into 12 monthly totals. */
export function monthlySums(series: ArrayLike<number>): number[] {
  assert8760(series, 'series')
  return monthHourRanges().map(({ start, end }) => {
    let s = 0
    for (let h = start; h < end; h++) s += series[h]!
    return s
  })
}

export function assert8760(series: ArrayLike<number>, name: string): void {
  if (series.length !== HOURS_PER_YEAR) {
    throw new Error(`${name} must have ${HOURS_PER_YEAR} hourly values, got ${series.length}`)
  }
}

export function sum(series: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < series.length; i++) s += series[i]!
  return s
}
```

Append to `index.ts`:
```ts
export * from './time'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/time.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/time.ts packages/shared/src/services/solar/time.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): 8760 SAST reference-year time base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: PVGIS TMY parser (JSON and CSV)

**Files:**
- Create: `packages/shared/src/services/solar/weather/pvgis-tmy.ts`
- Test: `packages/shared/src/services/solar/weather/pvgis-tmy.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

The two samples below are trimmed from the real responses to
`https://re.jrc.ec.europa.eu/api/v5_2/tmy?lat=-26.2&lon=28.05&outputformat=json` and `…&outputformat=csv`, fetched 2026-09-28. Documented PVGIS 5.2 TMY fields: `time(UTC)` (`YYYYMMDD:HHMM`), `T2m` °C, `RH` %, `G(h)` GHI, `Gb(n)` DNI, `Gd(h)` DHI, `IR(h)` (all W/m²), `WS10m` m/s, `WD10m` °, `SP` Pa; `inputs.location.irradiance_time_offset` in hours. The CSV is served with CRLF line endings and night irradiance as `-0.0`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/weather/pvgis-tmy.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parsePvgisTmyCsv, parsePvgisTmyJson } from './pvgis-tmy'

// Trimmed from the real response of
// https://re.jrc.ec.europa.eu/api/v5_2/tmy?lat=-26.2&lon=28.05&outputformat=json (fetched 2026-09-28).
const JSON_SAMPLE = {
  inputs: {
    location: { latitude: -26.2, longitude: 28.05, elevation: 1746.0, irradiance_time_offset: 0.0518 },
    meteo_data: { radiation_db: 'PVGIS-SARAH2', meteo_db: 'ERA5', year_min: 2005, year_max: 2020, use_horizon: true, horizon_db: 'DEM-calculated' },
  },
  outputs: {
    months_selected: [{ month: 1, year: 2005 }, { month: 2, year: 2019 }],
    tmy_hourly: [
      { 'time(UTC)': '20050101:0000', T2m: 19.99, RH: 71.57, 'G(h)': 0.0, 'Gb(n)': 0.0, 'Gd(h)': 0.0, 'IR(h)': 248.97, WS10m: 2.57, WD10m: 61.0, SP: 82144.0 },
      { 'time(UTC)': '20050101:0800', T2m: 23.32, RH: 61.4, 'G(h)': 848, 'Gb(n)': 736.75, 'Gd(h)': 205, 'IR(h)': 364.6, WS10m: 3.93, WD10m: 342, SP: 82435 },
      { 'time(UTC)': '20050101:0900', T2m: 24.22, RH: 58.2, 'G(h)': 989, 'Gb(n)': 807.48, 'Gd(h)': 212, 'IR(h)': 375.6, WS10m: 3.1, WD10m: 330, SP: 82403 },
    ],
  },
}

// Trimmed from the same query with outputformat=csv (CRLF line endings, as served).
const CSV_SAMPLE = [
  'Latitude (decimal degrees): -26.200',
  'Longitude (decimal degrees): 28.050',
  'Elevation (m): 1746.0',
  'Irradiance Time Offset (h): 0.0518',
  'month,year',
  '1,2005',
  '2,2019',
  'time(UTC),T2m,RH,G(h),Gb(n),Gd(h),IR(h),WS10m,WD10m,SP',
  '20050101:0000,19.99,71.57,0.0,-0.0,0.0,248.97,2.57,61.0,82144.0',
  '20050101:0800,23.32,61.4,848.0,736.75,205.0,364.6,3.93,342.0,82435.0',
  '20050101:0900,24.22,58.2,989.0,807.48,212.0,375.6,3.1,330.0,82403.0',
  '',
  'T2m: 2-m air temperature (degree Celsius)',
  'G(h): Global irradiance on the horizontal plane (W/m2)',
  '',
  'PVGIS (c) European Union, 2001-2026',
  '',
].join('\r\n')

describe('parsePvgisTmyJson', () => {
  it('reads the location block, the irradiance time offset and every hourly field', () => {
    const t = parsePvgisTmyJson(JSON_SAMPLE)
    expect(t).toMatchObject({ latitude: -26.2, longitude: 28.05, elevation: 1746, irradianceTimeOffsetH: 0.0518, radiationDb: 'PVGIS-SARAH2' })
    expect(t.rows).toHaveLength(3)
    expect(t.rows[1]).toEqual({ sourceYear: 2005, month: 1, day: 1, hourUtc: 8, t2m: 23.32, ghi: 848, dni: 736.75, dhi: 205, ws10m: 3.93, sp: 82435 })
  })

  it('refuses a body that is not a TMY response', () => {
    expect(() => parsePvgisTmyJson({ outputs: {} })).toThrow(/Not a PVGIS TMY JSON response/)
  })

  it('refuses a row with a missing field or a bad timestamp', () => {
    const noDni = structuredClone(JSON_SAMPLE)
    delete (noDni.outputs.tmy_hourly[0] as Record<string, unknown>)['Gb(n)']
    expect(() => parsePvgisTmyJson(noDni)).toThrow(/row 0: missing field Gb\(n\)/)
    const badTime = structuredClone(JSON_SAMPLE)
    badTime.outputs.tmy_hourly[2]!['time(UTC)'] = '2005-01-01 09:00'
    expect(() => parsePvgisTmyJson(badTime)).toThrow(/row 2: bad time\(UTC\)/)
  })
})

describe('parsePvgisTmyCsv', () => {
  it('reads the header block and stops at the legend', () => {
    const t = parsePvgisTmyCsv(CSV_SAMPLE)
    expect(t).toMatchObject({ latitude: -26.2, longitude: 28.05, elevation: 1746, irradianceTimeOffsetH: 0.0518 })
    expect(t.rows).toHaveLength(3)
    expect(t.rows[2]).toEqual({ sourceYear: 2005, month: 1, day: 1, hourUtc: 9, t2m: 24.22, ghi: 989, dni: 807.48, dhi: 212, ws10m: 3.1, sp: 82403 })
  })

  it('clamps the "-0.0" night irradiance PVGIS writes to +0', () => {
    const t = parsePvgisTmyCsv(CSV_SAMPLE)
    expect(Object.is(t.rows[0]!.dni, 0)).toBe(true)
  })

  it('JSON and CSV of the same response agree row for row', () => {
    expect(parsePvgisTmyCsv(CSV_SAMPLE).rows).toEqual(parsePvgisTmyJson(JSON_SAMPLE).rows)
  })

  it('refuses a non-numeric cell', () => {
    expect(() => parsePvgisTmyCsv(CSV_SAMPLE.replace('848.0', 'n/a'))).toThrow(/G\(h\) is not a number/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/weather/pvgis-tmy.test.ts`
Expected: FAIL — `Failed to resolve import "./pvgis-tmy"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/weather/pvgis-tmy.ts`:
```ts
/**
 * Parser for the PVGIS 5.2 `tmy` endpoint (JSON and CSV output formats).
 *
 * Documented fields per hourly row: `time(UTC)` as `YYYYMMDD:HHMM`, `T2m` (°C), `RH` (%),
 * `G(h)` GHI, `Gb(n)` DNI, `Gd(h)` DHI (W/m²), `IR(h)` (W/m²), `WS10m` (m/s), `WD10m` (°),
 * `SP` (Pa). The location block carries `irradiance_time_offset` (hours): the irradiance
 * of a row stamped HH:00 UTC was sampled at HH:00 + offset.
 *
 * Fetching is a server concern (Phase 4b). This module only turns the response into rows.
 */

export interface PvgisTmyRow {
  /** Year the TMY took this month from (TMY months come from different years). */
  sourceYear: number
  month: number
  day: number
  hourUtc: number
  t2m: number
  ghi: number
  dni: number
  dhi: number
  ws10m: number
  /** Surface pressure, Pa. */
  sp: number
}

export interface PvgisTmy {
  latitude: number
  longitude: number
  elevation: number
  irradianceTimeOffsetH: number
  radiationDb: string | null
  rows: PvgisTmyRow[]
}

const REQUIRED = ['time(UTC)', 'T2m', 'G(h)', 'Gb(n)', 'Gd(h)', 'WS10m', 'SP'] as const

function num(v: unknown, field: string, i: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) throw new Error(`PVGIS TMY row ${i}: ${field} is not a number (${String(v)})`)
  return n
}

/** PVGIS writes `-0.0` and tiny negatives at night; irradiance is clamped at zero. */
function irr(v: unknown, field: string, i: number): number {
  return Math.max(0, num(v, field, i))
}

function parseStamp(stamp: unknown, i: number) {
  const m = typeof stamp === 'string' ? /^(\d{4})(\d{2})(\d{2}):(\d{2})(\d{2})$/.exec(stamp.trim()) : null
  if (!m) throw new Error(`PVGIS TMY row ${i}: bad time(UTC) ${String(stamp)}`)
  return { sourceYear: +m[1]!, month: +m[2]!, day: +m[3]!, hourUtc: +m[4]! }
}

function toRow(rec: Record<string, unknown>, i: number): PvgisTmyRow {
  for (const k of REQUIRED) {
    if (!(k in rec)) throw new Error(`PVGIS TMY row ${i}: missing field ${k}`)
  }
  return {
    ...parseStamp(rec['time(UTC)'], i),
    t2m: num(rec['T2m'], 'T2m', i),
    ghi: irr(rec['G(h)'], 'G(h)', i),
    dni: irr(rec['Gb(n)'], 'Gb(n)', i),
    dhi: irr(rec['Gd(h)'], 'Gd(h)', i),
    ws10m: Math.max(0, num(rec['WS10m'], 'WS10m', i)),
    sp: num(rec['SP'], 'SP', i),
  }
}

export function parsePvgisTmyJson(body: unknown): PvgisTmy {
  const b = body as {
    inputs?: {
      location?: { latitude?: number; longitude?: number; elevation?: number; irradiance_time_offset?: number }
      meteo_data?: { radiation_db?: string }
    }
    outputs?: { tmy_hourly?: Record<string, unknown>[] }
  }
  const loc = b?.inputs?.location
  const rows = b?.outputs?.tmy_hourly
  if (!loc || !Array.isArray(rows)) throw new Error('Not a PVGIS TMY JSON response (inputs.location / outputs.tmy_hourly)')
  return {
    latitude: num(loc.latitude, 'latitude', -1),
    longitude: num(loc.longitude, 'longitude', -1),
    elevation: num(loc.elevation, 'elevation', -1),
    irradianceTimeOffsetH: loc.irradiance_time_offset == null ? 0 : num(loc.irradiance_time_offset, 'irradiance_time_offset', -1),
    radiationDb: b.inputs?.meteo_data?.radiation_db ?? null,
    rows: rows.map(toRow),
  }
}

export function parsePvgisTmyCsv(text: string): PvgisTmy {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const header = (label: string): number | null => {
    const line = lines.find((l) => l.startsWith(label))
    if (!line) return null
    return num(line.slice(line.indexOf(':') + 1), label, -1)
  }
  const latitude = header('Latitude')
  const longitude = header('Longitude')
  const elevation = header('Elevation')
  if (latitude == null || longitude == null || elevation == null) {
    throw new Error('Not a PVGIS TMY CSV response (missing Latitude/Longitude/Elevation header)')
  }
  const headIdx = lines.findIndex((l) => l.startsWith('time(UTC),'))
  if (headIdx < 0) throw new Error('PVGIS TMY CSV: no time(UTC) header row')
  const cols = lines[headIdx]!.split(',').map((c) => c.trim())
  const rows: PvgisTmyRow[] = []
  for (let i = headIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!/^\d{8}:\d{4},/.test(line)) break // the legend block after the data starts with a blank line
    const cells = line.split(',')
    const rec: Record<string, unknown> = {}
    cols.forEach((c, j) => (rec[c] = cells[j]))
    rows.push(toRow(rec, rows.length))
  }
  return {
    latitude,
    longitude,
    elevation,
    irradianceTimeOffsetH: header('Irradiance Time Offset') ?? 0,
    radiationDb: null,
    rows,
  }
}
```

Append to `index.ts`:
```ts
export * from './weather/pvgis-tmy'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/weather/pvgis-tmy.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/weather/pvgis-tmy.ts packages/shared/src/services/solar/weather/pvgis-tmy.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): PVGIS 5.2 TMY parser (JSON + CSV)

Real trimmed samples as fixtures; -0.0 night irradiance clamped; a missing field
or bad timestamp is refused with the row number.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Reference year — drop 29 Feb, order by calendar, shift UTC → SAST

**Files:**
- Create: `packages/shared/src/services/solar/weather/reference-year.ts`
- Test: `packages/shared/src/services/solar/weather/reference-year.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/weather/reference-year.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DAYS_IN_MONTH } from '../time'
import type { PvgisTmy, PvgisTmyRow } from './pvgis-tmy'
import { temperatureExtremes, tmyToReferenceYear } from './reference-year'

/** One row per non-leap UTC hour; ghi carries the UTC hour-of-year index so shifts are visible. */
function syntheticTmy(): PvgisTmy {
  const rows: PvgisTmyRow[] = []
  let u = 0
  for (let m = 1; m <= 12; m++) {
    const sourceYear = 2005 + m // months from different years, as in a real TMY
    for (let d = 1; d <= DAYS_IN_MONTH[m - 1]!; d++) {
      for (let h = 0; h < 24; h++) {
        rows.push({ sourceYear, month: m, day: d, hourUtc: h, t2m: u % 40, ghi: u, dni: 0, dhi: 0, ws10m: 1, sp: 100000 })
        u++
      }
    }
  }
  return { latitude: -26.2, longitude: 28.05, elevation: 1746, irradianceTimeOffsetH: 0.05, radiationDb: 'PVGIS-SARAH2', rows }
}

describe('tmyToReferenceYear', () => {
  it('shifts UTC → SAST by +2 h, wrapping the last two UTC hours to 1 Jan 00:00–02:00 SAST', () => {
    const w = tmyToReferenceYear(syntheticTmy())
    expect(w.ghi.length).toBe(8760)
    expect(w.ghi[0]).toBe(8758) // 31 Dec 22:00 UTC
    expect(w.ghi[1]).toBe(8759) // 31 Dec 23:00 UTC
    expect(w.ghi[2]).toBe(0) //    1 Jan 00:00 UTC = 02:00 SAST
    expect(w.ghi[14]).toBe(12) //  12:00 UTC = 14:00 SAST
  })

  it('orders by calendar position, not by source year', () => {
    const t = syntheticTmy()
    t.rows.reverse()
    expect(Array.from(tmyToReferenceYear(t).ghi.slice(0, 5))).toEqual([8758, 8759, 0, 1, 2])
  })

  it('drops 29 February rows from a leap-year source month', () => {
    const t = syntheticTmy()
    for (let h = 0; h < 24; h++) t.rows.push({ ...t.rows[0]!, sourceYear: 2020, month: 2, day: 29, hourUtc: h, ghi: -1 })
    const w = tmyToReferenceYear(t)
    expect(Math.min(...w.ghi)).toBe(0)
  })

  it('refuses a duplicated or a missing hour', () => {
    const dup = syntheticTmy()
    dup.rows.push({ ...dup.rows[100]! })
    expect(() => tmyToReferenceYear(dup)).toThrow(/duplicate TMY hour/)
    const gap = syntheticTmy()
    gap.rows.splice(5000, 1)
    expect(() => tmyToReferenceYear(gap)).toThrow(/missing UTC hour index 5000/)
  })

  it('converts pressure Pa → hPa, carries the sample offset and names the source', () => {
    const w = tmyToReferenceYear(syntheticTmy())
    expect(w.pressure[0]).toBe(1000)
    expect(w.sampleOffsetH).toBe(0.05)
    expect(w.source).toBe('PVGIS-SARAH2 PVGIS TMY')
  })

  it('reports the ambient temperature extremes for string sizing', () => {
    expect(temperatureExtremes(tmyToReferenceYear(syntheticTmy()))).toEqual({ minC: 0, maxC: 39 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/weather/reference-year.test.ts`
Expected: FAIL — `Failed to resolve import "./reference-year"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/weather/reference-year.ts`:
```ts
import { HOURS_PER_YEAR, SAST_OFFSET_HOURS, dayOfYear0 } from '../time'
import type { PvgisTmy } from './pvgis-tmy'

/**
 * One reference year of weather on the engine time base (SAST hour index 0…8759).
 *
 * `sampleOffsetH` is where inside each SAST hour the irradiance was sampled (PVGIS
 * `irradiance_time_offset`): the value at index h belongs to instant h + sampleOffsetH.
 * The PV model places the sun at that instant, then re-centres power on the hour midpoint.
 */
export interface WeatherYear {
  latitude: number
  longitude: number
  elevation: number
  sampleOffsetH: number
  ghi: Float64Array
  dni: Float64Array
  dhi: Float64Array
  tAmb: Float64Array
  wind: Float64Array
  /** hPa */
  pressure: Float64Array
  /** Provenance, e.g. "PVGIS-SARAH2 TMY". */
  source: string
}

/** Minimum and maximum ambient temperature of the year — string sizing inputs (spec §3.3). */
export function temperatureExtremes(w: WeatherYear): { minC: number; maxC: number } {
  let minC = Number.POSITIVE_INFINITY
  let maxC = Number.NEGATIVE_INFINITY
  for (const t of w.tAmb) {
    if (t < minC) minC = t
    if (t > maxC) maxC = t
  }
  return { minC, maxC }
}

/**
 * PVGIS TMY rows (UTC, months drawn from different years) → the engine reference year:
 *  1. drop 29 February (spec §1.2);
 *  2. order by (month, day, hour) — never by source year;
 *  3. refuse anything that is not exactly one row per non-leap UTC hour;
 *  4. shift UTC → SAST by +2 h, wrapping 31 Dec 22:00–23:59 UTC to 1 Jan 00:00–02:00 SAST.
 */
export function tmyToReferenceYear(tmy: PvgisTmy, source = 'PVGIS TMY'): WeatherYear {
  const byUtcHour: (PvgisTmy['rows'][number] | undefined)[] = new Array(HOURS_PER_YEAR)
  for (const r of tmy.rows) {
    if (r.month === 2 && r.day === 29) continue
    if (!Number.isInteger(r.hourUtc) || r.hourUtc < 0 || r.hourUtc > 23) throw new Error(`bad UTC hour ${r.hourUtc}`)
    const u = dayOfYear0(r.month, r.day) * 24 + r.hourUtc
    if (byUtcHour[u]) throw new Error(`duplicate TMY hour ${r.month}/${r.day} ${r.hourUtc}:00 UTC`)
    byUtcHour[u] = r
  }
  for (let i = 0; i < HOURS_PER_YEAR; i++) {
    if (!byUtcHour[i]) throw new Error(`TMY is missing UTC hour index ${i} (day ${Math.floor(i / 24) + 1}, ${i % 24}:00 UTC)`)
  }

  const out = {
    ghi: new Float64Array(HOURS_PER_YEAR),
    dni: new Float64Array(HOURS_PER_YEAR),
    dhi: new Float64Array(HOURS_PER_YEAR),
    tAmb: new Float64Array(HOURS_PER_YEAR),
    wind: new Float64Array(HOURS_PER_YEAR),
    pressure: new Float64Array(HOURS_PER_YEAR),
  }
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const r = byUtcHour[(h - SAST_OFFSET_HOURS + HOURS_PER_YEAR) % HOURS_PER_YEAR]!
    out.ghi[h] = r.ghi
    out.dni[h] = r.dni
    out.dhi[h] = r.dhi
    out.tAmb[h] = r.t2m
    out.wind[h] = r.ws10m
    out.pressure[h] = r.sp / 100
  }
  return {
    latitude: tmy.latitude,
    longitude: tmy.longitude,
    elevation: tmy.elevation,
    sampleOffsetH: tmy.irradianceTimeOffsetH,
    source: tmy.radiationDb ? `${tmy.radiationDb} ${source}` : source,
    ...out,
  }
}
```

Append to `index.ts`:
```ts
export * from './weather/reference-year'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/weather/reference-year.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/weather/reference-year.ts packages/shared/src/services/solar/weather/reference-year.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): TMY → 8760 SAST reference year (UTC+2 shift, 29 Feb dropped)

WM Solar used PVGIS weather in UTC, so its PV peaked two hours early. The shift is
circular: 31 Dec 22:00–23:59 UTC becomes 1 Jan 00:00–02:00 SAST.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: NREL SPA solar position

**Files:**
- Create: `packages/shared/scripts/solar/gen-spa-tables.mjs`
- Generate: `packages/shared/src/services/solar/solar-position/spa-tables.ts`
- Create: `packages/shared/src/services/solar/solar-position/spa.ts`
- Test: `packages/shared/src/services/solar/solar-position/spa.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/solar-position/spa.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { solarPosition } from './spa'

describe('solarPosition (NREL SPA)', () => {
  it('reproduces the Reda & Andreas (2004) worked example to 1e-4°', () => {
    // 17 Oct 2003 12:30:30 local (UTC−7), Golden CO; NREL/TP-560-34302 Table A5.1:
    // topocentric zenith 50.11162°, azimuth 194.34024°.
    const p = solarPosition(Date.UTC(2003, 9, 17, 19, 30, 30), 39.742476, -105.1786, {
      elevationM: 1830.14,
      pressureHpa: 820,
      temperatureC: 11,
      deltaT: 67,
      atmosRefract: 0.5667,
    })
    expect(p.zenith).toBeCloseTo(50.11162, 4)
    expect(p.azimuth).toBeCloseTo(194.34024, 4)
    expect(p.elevation).toBeCloseTo(90 - 50.11162, 4)
  })

  it('azimuth is clockwise from north: morning east, afternoon west, noon north in Johannesburg', () => {
    const o = { elevationM: 1746, pressureHpa: 830, temperatureC: 20 }
    const morning = solarPosition(Date.UTC(2025, 5, 21, 6), -26.2, 28.05, o) // 08:00 SAST
    const noon = solarPosition(Date.UTC(2025, 5, 21, 10, 8), -26.2, 28.05, o)
    const afternoon = solarPosition(Date.UTC(2025, 5, 21, 14), -26.2, 28.05, o)
    expect(morning.azimuth).toBeGreaterThan(0)
    expect(morning.azimuth).toBeLessThan(90)
    expect(Math.min(noon.azimuth, 360 - noon.azimuth)).toBeLessThan(2)
    expect(afternoon.azimuth).toBeGreaterThan(270)
  })

  it('winter-solstice noon elevation in Johannesburg is 90 − 26.2 − 23.44 ≈ 40.4°', () => {
    let best = -90
    for (let m = 0; m < 240; m++) {
      const p = solarPosition(Date.UTC(2025, 5, 21, 8) + m * 60_000, -26.2, 28.05, { elevationM: 1746, pressureHpa: 830, temperatureC: 15 })
      best = Math.max(best, p.elevation)
    }
    expect(best).toBeGreaterThan(40.3)
    expect(best).toBeLessThan(40.5)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/solar-position/spa.test.ts`
Expected: FAIL — `Failed to resolve import "./spa"`.

- [ ] **Step 3: Add the table generator and generate the tables**

`packages/shared/scripts/solar/gen-spa-tables.mjs`:
```js
#!/usr/bin/env node
// Generates packages/shared/src/services/solar/solar-position/spa-tables.ts from pvlib-python's
// spa.py (BSD-3-Clause) at a PINNED commit. The tables are the periodic terms of Reda & Andreas
// (2004), "Solar Position Algorithm for Solar Radiation Applications", NREL/TP-560-34302.
//
// Usage: node packages/shared/scripts/solar/gen-spa-tables.mjs > packages/shared/src/services/solar/solar-position/spa-tables.ts
const SHA = '92bb1e51a0a1ffca2539af7c6f386835cb5cadf7'
const URL = `https://raw.githubusercontent.com/pvlib/pvlib-python/${SHA}/pvlib/spa.py`

const src = await (await fetch(URL)).text()
const names = [
  ['L0', 'L0'], ['L1', 'L1'], ['L2', 'L2'], ['L3', 'L3'], ['L4', 'L4'], ['L5', 'L5'],
  ['B0', 'B0'], ['B1', 'B1'],
  ['R0', 'R0'], ['R1', 'R1'], ['R2', 'R2'], ['R3', 'R3'], ['R4', 'R4'],
  ['NUTATION_ABCD_ARRAY', 'NUTATION_ABCD'], ['NUTATION_YTERM_ARRAY', 'NUTATION_Y'],
]
const expected = { L0: 64, L1: 34, L2: 20, L3: 7, L4: 3, L5: 1, B0: 5, B1: 2, R0: 40, R1: 10, R2: 6, R3: 2, R4: 1, NUTATION_ABCD: 63, NUTATION_Y: 63 }

let out = `/* eslint-disable */
// GENERATED by packages/shared/scripts/solar/gen-spa-tables.mjs — do not edit by hand.
// Source: pvlib-python ${SHA} pvlib/spa.py (BSD-3-Clause, (c) pvlib python Contributors,
// (c) Sandia National Laboratories). Periodic terms from Reda & Andreas (2004), NREL/TP-560-34302.

`
for (const [py, ts] of names) {
  const at = src.indexOf(`${py} = np.array(`)
  if (at < 0) throw new Error(`table ${py} not found`)
  const start = src.indexOf('[', at)
  let depth = 0
  let end = start
  for (; end < src.length; end++) {
    if (src[end] === '[') depth++
    else if (src[end] === ']' && --depth === 0) break
  }
  const rows = JSON.parse(src.slice(start, end + 1).replace(/,\s*\]/g, ']'))
  if (rows.length !== expected[ts]) throw new Error(`${ts}: ${rows.length} rows, expected ${expected[ts]}`)
  out += `export const ${ts}: readonly (readonly number[])[] = [\n`
  out += rows.map((r) => `  [${r.map((x) => String(x)).join(', ')}],`).join('\n')
  out += '\n]\n\n'
}
process.stdout.write(out)
```

Run:
```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-4a
mkdir -p packages/shared/src/services/solar/solar-position
node packages/shared/scripts/solar/gen-spa-tables.mjs > packages/shared/src/services/solar/solar-position/spa-tables.ts
shasum -a 256 packages/shared/src/services/solar/solar-position/spa-tables.ts
wc -l packages/shared/src/services/solar/solar-position/spa-tables.ts
```
Expected: `50bfcea6e6f9f984b971ec2412304640a5844319e111e4fd07c82cd8d0b78ff2` and `371` lines. If the hash differs, STOP — the pinned upstream file changed or the fetch was altered; do not continue with a different table.

- [ ] **Step 4: Implement the algorithm**

`packages/shared/src/services/solar/solar-position/spa.ts`:
```ts
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
```

Append to `index.ts`:
```ts
export * from './solar-position/spa'
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/solar-position/spa.test.ts`
Expected: 3 passed (the planning prototype gave zenith 50.1116220, azimuth 194.3402405).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/scripts/solar/gen-spa-tables.mjs packages/shared/src/services/solar/solar-position packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): NREL SPA solar position (ported from pvlib, BSD-3)

Periodic-term tables generated from pvlib spa.py at pinned commit 92bb1e5 by a
checked-in script (sha256 50bfcea6…). Reproduces the Reda & Andreas worked example
to 1e-4°. Not derived from NREL's C source.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Transposition (Perez 1990, Hay–Davies), ground reflection, ASHRAE IAM

**Files:**
- Create: `packages/shared/src/services/solar/irradiance/transposition.ts`
- Create: `packages/shared/src/services/solar/irradiance/iam.ts`
- Test: `packages/shared/src/services/solar/irradiance/transposition.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append two lines)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/irradiance/transposition.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  beamOnPlane,
  cosAoi,
  extraterrestrialDni,
  groundReflected,
  hayDaviesSkyDiffuse,
  perezSkyDiffuse,
  relativeAirmass,
  type SkyInput,
} from './transposition'
import { ashraeIam, groundEquivalentAoi, skyDiffuseEquivalentAoi } from './iam'

const clear = (over: Partial<SkyInput> = {}): SkyInput => ({
  tiltDeg: 30,
  cosAoi: cosAoi(30, 0, 40, 10),
  zenithDeg: 40,
  dni: 850,
  dhi: 110,
  dniExtra: 1400,
  airmass: relativeAirmass(40),
  ...over,
})

describe('geometry', () => {
  it('cos AOI of a horizontal plane is cos(zenith); a plane facing the sun sees 1', () => {
    expect(cosAoi(0, 0, 60, 123)).toBeCloseTo(0.5, 12)
    expect(cosAoi(35, 20, 35, 20)).toBeCloseTo(1, 12)
  })

  it('extraterrestrial DNI peaks near perihelion (January) and dips in July', () => {
    expect(extraterrestrialDni(3)).toBeGreaterThan(1410)
    expect(extraterrestrialDni(185)).toBeLessThan(1325)
  })

  it('Kasten–Young air mass: ≈1 overhead, ≈2 at 60°, NaN below the horizon', () => {
    expect(relativeAirmass(0)).toBeCloseTo(0.99970, 4)
    expect(relativeAirmass(60)).toBeCloseTo(1.99427, 4)
    expect(relativeAirmass(91)).toBeNaN()
  })

  it('beam on plane is DNI × cos AOI, zero behind the plane or below the horizon', () => {
    expect(beamOnPlane(800, 0.5, 30)).toBe(400)
    expect(beamOnPlane(800, -0.2, 30)).toBe(0)
    expect(beamOnPlane(800, 0.5, 95)).toBe(0)
  })

  it('ground reflected = GHI × albedo × (1 − cos β)/2', () => {
    expect(groundReflected(1000, 0.2, 0)).toBe(0)
    expect(groundReflected(1000, 0.2, 90)).toBeCloseTo(100, 10)
  })
})

describe('Perez 1990 and Hay–Davies', () => {
  it('both return exactly DHI on a horizontal plane', () => {
    const flat = clear({ tiltDeg: 0, cosAoi: cosAoi(0, 0, 40, 10) })
    expect(perezSkyDiffuse(flat)).toBeCloseTo(110, 9)
    expect(hayDaviesSkyDiffuse(flat)).toBeCloseTo(110, 9)
  })

  it('under a clear sky both put more diffuse on a sun-facing plane than the isotropic model', () => {
    const iso = (110 * (1 + Math.cos((30 * Math.PI) / 180))) / 2
    expect(perezSkyDiffuse(clear())).toBeGreaterThan(iso)
    expect(hayDaviesSkyDiffuse(clear())).toBeGreaterThan(iso)
  })

  it('zero diffuse in, zero out; sun below the horizon falls back to isotropic', () => {
    expect(perezSkyDiffuse(clear({ dhi: 0 }))).toBe(0)
    const night = clear({ zenithDeg: 95, airmass: relativeAirmass(95), dni: 0, dhi: 10 })
    expect(perezSkyDiffuse(night)).toBeCloseTo((10 * (1 + Math.cos(Math.PI / 6))) / 2, 9)
  })

  it('Perez picks the clearest bin for a clear sky (hand-evaluated from the 1990 coefficient table)', () => {
    // ε = ((110 + 850)/110 + 1.041 z³)/(1 + 1.041 z³), z = 40° → ε ≈ 6.71 → last bin (ε ≥ 6.2)
    // Δ = 110 × AM / 1400; F1 = max(0, 0.678 − 0.327Δ − 0.25z); F2 = 0.156 − 1.377Δ + 0.251z
    const i = clear()
    const z = (40 * Math.PI) / 180
    const delta = (110 * i.airmass) / 1400
    const F1 = Math.max(0, 0.678 - 0.327 * delta - 0.25 * z)
    const F2 = 0.156 - 1.377 * delta + 0.251 * z
    const t = Math.PI / 6
    const expected = 110 * ((1 - F1) * (1 + Math.cos(t)) * 0.5 + (F1 * i.cosAoi) / Math.cos(z) + F2 * Math.sin(t))
    expect(perezSkyDiffuse(i)).toBeCloseTo(expected, 9)
  })
})

describe('ASHRAE IAM', () => {
  it('1 at normal incidence, 0.95 at 60° (b0 = 0.05), 0 at and beyond 90°, never negative', () => {
    expect(ashraeIam(0, 0.05)).toBe(1)
    expect(ashraeIam(60, 0.05)).toBeCloseTo(0.95, 12)
    expect(ashraeIam(88, 0.05)).toBe(0)
    expect(ashraeIam(90, 0.05)).toBe(0)
  })

  it('Brandemuehl–Beckman equivalent angles: 59.7° sky / 90° ground for a flat plane', () => {
    expect(skyDiffuseEquivalentAoi(0)).toBe(59.7)
    expect(groundEquivalentAoi(0)).toBe(90)
    expect(skyDiffuseEquivalentAoi(30)).toBeCloseTo(59.7 - 4.164 + 1.3473, 9)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/irradiance/transposition.test.ts`
Expected: FAIL — `Failed to resolve import "./transposition"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/irradiance/transposition.ts`:
```ts
/**
 * Plane-of-array irradiance (engine spec §3.4).
 *
 * Perez et al. 1990 ("Modeling daylight availability and irradiance components from direct and
 * global irradiance", Solar Energy 44(5)) with the "allsitescomposite1990" coefficient set, as
 * tabulated in pvlib-python `irradiance.py` (BSD-3-Clause). Hay & Davies 1980 is the fallback.
 * Angles in degrees; azimuths clockwise from north (spec §3.2).
 */

const rad = (d: number) => (d * Math.PI) / 180

/** cos(angle of incidence) between the sun and a surface normal (may be negative). */
export function cosAoi(tiltDeg: number, surfaceAzDeg: number, zenithDeg: number, sunAzDeg: number): number {
  const z = rad(zenithDeg)
  const t = rad(tiltDeg)
  return Math.cos(z) * Math.cos(t) + Math.sin(z) * Math.sin(t) * Math.cos(rad(sunAzDeg - surfaceAzDeg))
}

/** Extraterrestrial normal irradiance, W/m² (Spencer 1971, solar constant 1366.1). dayOfYear 1…365. */
export function extraterrestrialDni(dayOfYear: number): number {
  const b = (2 * Math.PI * (dayOfYear - 1)) / 365
  return (
    1366.1 *
    (1.00011 + 0.034221 * Math.cos(b) + 0.00128 * Math.sin(b) + 0.000719 * Math.cos(2 * b) + 0.000077 * Math.sin(2 * b))
  )
}

/** Relative (not pressure-corrected) air mass, Kasten & Young 1989. NaN when the sun is down. */
export function relativeAirmass(zenithDeg: number): number {
  if (zenithDeg >= 90) return NaN
  return 1 / (Math.cos(rad(zenithDeg)) + 0.50572 * (96.07995 - zenithDeg) ** -1.6364)
}

// [f11, f12, f13, f21, f22, f23] per sky-clearness bin (allsitescomposite1990).
const PEREZ: readonly (readonly number[])[] = [
  [-0.008, 0.588, -0.062, -0.06, 0.072, -0.022],
  [0.13, 0.683, -0.151, -0.019, 0.066, -0.029],
  [0.33, 0.487, -0.221, 0.055, -0.064, -0.026],
  [0.568, 0.187, -0.295, 0.109, -0.152, -0.014],
  [0.873, -0.392, -0.362, 0.226, -0.462, 0.001],
  [1.132, -1.237, -0.412, 0.288, -0.823, 0.056],
  [1.06, -1.6, -0.359, 0.264, -1.127, 0.131],
  [0.678, -0.327, -0.25, 0.156, -1.377, 0.251],
]
const EPS_BINS = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2]

export interface SkyInput {
  tiltDeg: number
  cosAoi: number
  zenithDeg: number
  dni: number
  dhi: number
  dniExtra: number
  airmass: number
}

const isotropic = (dhi: number, tiltDeg: number) => (dhi * (1 + Math.cos(rad(tiltDeg)))) / 2

/** Perez 1990 sky diffuse on the tilted plane, W/m². Isotropic when the sun is below the horizon. */
export function perezSkyDiffuse(i: SkyInput): number {
  if (i.dhi <= 0) return 0
  if (i.zenithDeg >= 90 || !Number.isFinite(i.airmass)) return isotropic(i.dhi, i.tiltDeg)
  const kappa = 1.041
  const z = rad(i.zenithDeg)
  const eps = ((i.dhi + i.dni) / i.dhi + kappa * z ** 3) / (1 + kappa * z ** 3)
  let bin = 0
  while (bin < EPS_BINS.length && eps >= EPS_BINS[bin]!) bin++
  const f = PEREZ[bin]!
  const delta = (i.dhi * i.airmass) / i.dniExtra
  const F1 = Math.max(0, f[0]! + f[1]! * delta + z * f[2]!)
  const F2 = f[3]! + f[4]! * delta + z * f[5]!
  const a = Math.max(0, i.cosAoi)
  const b = Math.max(Math.cos(rad(85)), Math.cos(z))
  const t = rad(i.tiltDeg)
  const sky = i.dhi * ((1 - F1) * (1 + Math.cos(t)) * 0.5 + (F1 * a) / b + F2 * Math.sin(t))
  return Math.max(0, sky)
}

/** Hay & Davies 1980 sky diffuse on the tilted plane, W/m². */
export function hayDaviesSkyDiffuse(i: SkyInput): number {
  if (i.dhi <= 0) return 0
  if (i.zenithDeg >= 90) return isotropic(i.dhi, i.tiltDeg)
  const ai = Math.min(1, i.dni / i.dniExtra)
  const rb = Math.max(0, i.cosAoi) / Math.max(Math.cos(rad(85)), Math.cos(rad(i.zenithDeg)))
  return Math.max(0, i.dhi * (ai * rb + (1 - ai) * (1 + Math.cos(rad(i.tiltDeg))) * 0.5))
}

/** Ground-reflected irradiance on the tilted plane, W/m². */
export function groundReflected(ghi: number, albedo: number, tiltDeg: number): number {
  return (ghi * albedo * (1 - Math.cos(rad(tiltDeg)))) / 2
}

/** Beam on the plane: DNI × cos(AOI) for AOI < 90° and the sun above the horizon. */
export function beamOnPlane(dni: number, cosAoiValue: number, zenithDeg: number): number {
  return zenithDeg < 90 && cosAoiValue > 0 ? dni * cosAoiValue : 0
}
```

`packages/shared/src/services/solar/irradiance/iam.ts`:
```ts
/**
 * Incidence-angle modifier (engine spec §3.4): ASHRAE `IAM = 1 − b0 (1/cos θ − 1)`, clamped to
 * [0, 1], zero at θ ≥ 90°. Diffuse and ground-reflected light use the Brandemuehl & Beckman
 * equivalent incidence angles (Duffie & Beckman, Solar Engineering of Thermal Processes, eq. 5.4.1–2).
 */

const rad = (d: number) => (d * Math.PI) / 180

export function ashraeIam(aoiDeg: number, b0: number): number {
  if (aoiDeg >= 90) return 0
  const iam = 1 - b0 * (1 / Math.cos(rad(aoiDeg)) - 1)
  return Math.min(1, Math.max(0, iam))
}

/** Equivalent incidence angle of isotropic sky diffuse on a plane tilted β degrees. */
export function skyDiffuseEquivalentAoi(tiltDeg: number): number {
  return 59.7 - 0.1388 * tiltDeg + 0.001497 * tiltDeg ** 2
}

/** Equivalent incidence angle of ground-reflected light on a plane tilted β degrees. */
export function groundEquivalentAoi(tiltDeg: number): number {
  return 90 - 0.5788 * tiltDeg + 0.002693 * tiltDeg ** 2
}
```

Append to `index.ts`:
```ts
export * from './irradiance/transposition'
export * from './irradiance/iam'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/irradiance/transposition.test.ts`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/irradiance packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): Perez 1990 + Hay–Davies transposition, ASHRAE IAM

Perez allsitescomposite1990 coefficients as tabulated in pvlib (BSD-3). Diffuse and
ground light get IAM at the Brandemuehl–Beckman equivalent angles.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Cell temperature, loss chain, inverter

**Files:**
- Create: `packages/shared/src/services/solar/pv/cell-temperature.ts`
- Create: `packages/shared/src/services/solar/pv/losses.ts`
- Create: `packages/shared/src/services/solar/pv/inverter.ts`
- Test: `packages/shared/src/services/solar/pv/components.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append three lines)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/pv/components.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cellTemperature, DEFAULT_FAIMAN } from './cell-temperature'
import { acFactor, combinedDcLoss, DEFAULT_AC_LOSSES, DEFAULT_DC_LOSSES } from './losses'
import { efficiencyAt, inverterOutput, validateCurve } from './inverter'

describe('cell temperature', () => {
  it('NOCT: 20 °C + 800 W/m² × (45 − 20)/800 = 45 °C at NOCT conditions', () => {
    expect(cellTemperature({ kind: 'noct', noctC: 45 }, 20, 800, 1)).toBe(45)
    expect(cellTemperature({ kind: 'noct', noctC: 45 }, 25, 0, 1)).toBe(25)
  })

  it('Faiman: T_amb + POA / (U0 + U1·wind); wind cools the module', () => {
    expect(cellTemperature(DEFAULT_FAIMAN, 20, 1000, 0)).toBeCloseTo(60, 10)
    expect(cellTemperature(DEFAULT_FAIMAN, 20, 1000, 5)).toBeCloseTo(20 + 1000 / (25 + 34.2), 10)
  })
})

describe('loss chain', () => {
  it('is multiplicative, not additive', () => {
    const l = { soiling: 0.02, shading: 0.03, mismatch: 0, dcWiring: 0, lid: 0, nameplate: 0 }
    expect(combinedDcLoss(l)).toBeCloseTo(1 - 0.98 * 0.97, 12) // 4.94 %, not 5 %
  })

  it('spec §7 defaults combine to 1 − 0.98·0.99·0.99·0.985·0.985', () => {
    expect(combinedDcLoss(DEFAULT_DC_LOSSES)).toBeCloseTo(1 - 0.98 * 0.99 * 0.99 * 0.985 * 0.985, 12)
    expect(acFactor(DEFAULT_AC_LOSSES)).toBeCloseTo(0.99 * 0.99, 12)
  })

  it('refuses a loss outside [0, 1) — a percentage typed as 2 instead of 0.02 is caught', () => {
    expect(() => combinedDcLoss({ ...DEFAULT_DC_LOSSES, soiling: 2 })).toThrow(/soiling must be a fraction/)
    expect(() => acFactor({ acWiring: 0.01, availability: 99 })).toThrow(/availability/)
  })
})

describe('inverter', () => {
  const curve = [
    { loadFraction: 0.1, efficiency: 0.94 },
    { loadFraction: 0.5, efficiency: 0.98 },
    { loadFraction: 1, efficiency: 0.97 },
  ]

  it('interpolates the efficiency curve and holds it flat past the ends', () => {
    expect(efficiencyAt(curve, 0.05)).toBe(0.94)
    expect(efficiencyAt(curve, 0.3)).toBeCloseTo(0.96, 12)
    expect(efficiencyAt(curve, 0.75)).toBeCloseTo(0.975, 12)
    expect(efficiencyAt(curve, 1.3)).toBe(0.97)
  })

  it('clips at the AC rating and reports the clipped power', () => {
    const o = inverterOutput(120, { id: 'i', acRatedKw: 100 })
    expect(o.pAcKw).toBe(100)
    expect(o.clippedKw).toBeCloseTo(120 * 0.975 - 100, 10)
    expect(inverterOutput(50, { id: 'i', acRatedKw: 100 })).toEqual({ pAcKw: 50 * 0.975, clippedKw: 0 })
    expect(inverterOutput(0, { id: 'i', acRatedKw: 100 })).toEqual({ pAcKw: 0, clippedKw: 0 })
  })

  it('refuses a curve with efficiencies above 1 or unordered load points', () => {
    expect(() => validateCurve([{ loadFraction: 0, efficiency: 97.5 }])).toThrow(/efficiency must be in \(0, 1\]/)
    expect(() => validateCurve([{ loadFraction: 0.5, efficiency: 0.9 }, { loadFraction: 0.2, efficiency: 0.9 }])).toThrow(/must increase/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/pv/components.test.ts`
Expected: FAIL — `Failed to resolve import "./cell-temperature"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/pv/cell-temperature.ts`:
```ts
/**
 * Cell temperature (engine spec §3.5).
 *  NOCT:   T_cell = T_amb + POA × (NOCT − 20) / 800
 *  Faiman: T_cell = T_amb + POA / (U0 + U1 × wind)   (Faiman 2008; defaults U0 = 25, U1 = 6.84)
 */

export type CellTempModel = { kind: 'noct'; noctC: number } | { kind: 'faiman'; u0: number; u1: number }

export const DEFAULT_FAIMAN = { kind: 'faiman', u0: 25, u1: 6.84 } as const

export function cellTemperature(model: CellTempModel, tAmbC: number, poaWm2: number, windMs: number): number {
  if (model.kind === 'noct') return tAmbC + (poaWm2 * (model.noctC - 20)) / 800
  return tAmbC + poaWm2 / (model.u0 + model.u1 * Math.max(0, windMs))
}
```

`packages/shared/src/services/solar/pv/losses.ts`:
```ts
/**
 * DC loss chain (engine spec §3.5): L_dc = 1 − Π(1 − l_i). Losses are MULTIPLICATIVE — WM Solar
 * displayed an additive sum beside a multiplicative calculation.
 * Every loss is a fraction in [0, 1).
 */

export interface DcLosses {
  soiling: number
  shading: number
  mismatch: number
  dcWiring: number
  lid: number
  nameplate: number
}

export interface AcLosses {
  acWiring: number
  /** Availability as a fraction, e.g. 0.99. */
  availability: number
}

/** Engine spec §7 defaults. Shading is the "no obstructions drawn" value for flush mount. */
export const DEFAULT_DC_LOSSES: DcLosses = {
  soiling: 0.02,
  shading: 0.01,
  mismatch: 0.01,
  dcWiring: 0.015,
  lid: 0.015,
  nameplate: 0,
}
export const DEFAULT_SHADING_RACKED = 0.03
export const DEFAULT_AC_LOSSES: AcLosses = { acWiring: 0.01, availability: 0.99 }

function check(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0 || v >= 1) throw new Error(`loss ${name} must be a fraction in [0, 1), got ${v}`)
}

/** Combined DC loss fraction. */
export function combinedDcLoss(l: DcLosses): number {
  let keep = 1
  for (const [k, v] of Object.entries(l)) {
    check(k, v)
    keep *= 1 - v
  }
  return 1 - keep
}

/** Multiplier applied after the inverter: (1 − AC wiring) × availability. */
export function acFactor(l: AcLosses): number {
  check('acWiring', l.acWiring)
  if (!Number.isFinite(l.availability) || l.availability <= 0 || l.availability > 1) {
    throw new Error(`availability must be in (0, 1], got ${l.availability}`)
  }
  return (1 - l.acWiring) * l.availability
}
```

`packages/shared/src/services/solar/pv/inverter.ts`:
```ts
/**
 * Inverter (engine spec §3.5):
 *   P_ac = min(P_dc × η(P_dc / P_dc,rated), P_ac,rated)
 *   clipping = max(0, P_dc × η − P_ac,rated)
 * η is linearly interpolated on the catalogue curve (load fraction → efficiency), held flat
 * beyond its ends. Default: flat Euro-efficiency 97.5 %.
 */

export interface EfficiencyPoint {
  loadFraction: number
  efficiency: number
}

export const FLAT_EURO_EFFICIENCY: readonly EfficiencyPoint[] = [{ loadFraction: 0, efficiency: 0.975 }]

export interface InverterSpec {
  id: string
  acRatedKw: number
  /** DC rating the efficiency curve's load fraction refers to. Defaults to acRatedKw. */
  dcRatedKw?: number
  efficiencyCurve?: readonly EfficiencyPoint[]
}

export function validateCurve(curve: readonly EfficiencyPoint[]): void {
  if (curve.length === 0) throw new Error('efficiency curve is empty')
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i]!
    if (!(p.efficiency > 0 && p.efficiency <= 1)) throw new Error(`efficiency must be in (0, 1], got ${p.efficiency}`)
    if (i > 0 && !(p.loadFraction > curve[i - 1]!.loadFraction)) throw new Error('efficiency curve load fractions must increase')
  }
}

export function efficiencyAt(curve: readonly EfficiencyPoint[], loadFraction: number): number {
  const first = curve[0]!
  if (curve.length === 1 || loadFraction <= first.loadFraction) return first.efficiency
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!
    const b = curve[i]!
    if (loadFraction <= b.loadFraction) {
      return a.efficiency + ((b.efficiency - a.efficiency) * (loadFraction - a.loadFraction)) / (b.loadFraction - a.loadFraction)
    }
  }
  return curve[curve.length - 1]!.efficiency
}

export function inverterOutput(pDcKw: number, inv: InverterSpec): { pAcKw: number; clippedKw: number } {
  if (pDcKw <= 0) return { pAcKw: 0, clippedKw: 0 }
  const curve = inv.efficiencyCurve ?? FLAT_EURO_EFFICIENCY
  const eta = efficiencyAt(curve, pDcKw / (inv.dcRatedKw ?? inv.acRatedKw))
  const unclipped = pDcKw * eta
  const pAcKw = Math.min(unclipped, inv.acRatedKw)
  return { pAcKw, clippedKw: unclipped - pAcKw }
}
```

Append to `index.ts`:
```ts
export * from './pv/cell-temperature'
export * from './pv/losses'
export * from './pv/inverter'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/pv/components.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/pv/cell-temperature.ts packages/shared/src/services/solar/pv/losses.ts packages/shared/src/services/solar/pv/inverter.ts packages/shared/src/services/solar/pv/components.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): NOCT/Faiman cell temperature, multiplicative losses, inverter clipping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: String sizing (spec §3.3)

**Files:**
- Create: `packages/shared/src/services/solar/pv/string-sizing.ts`
- Test: `packages/shared/src/services/solar/pv/string-sizing.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/pv/string-sizing.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cellTempMax, checkStringSizing, recommendedModulesInSeries, type StringSizingInput } from './string-sizing'

// Hand-computed case: Voc 49.5 V, Vmp 41.7 V, Isc 13.9 A, β_Voc −0.27 %/°C, γ_Vmp −0.35 %/°C;
// MPPT 1000 V max, 200–850 V window, 26 A; site −5 °C … 35 °C, racked (T_cell,max = 70 °C).
const base: StringSizingInput = {
  module: { vocStc: 49.5, vmpStc: 41.7, iscStc: 13.9, betaVocPerC: -0.0027, gammaVmpPerC: -0.0035 },
  mppt: { vDcMax: 1000, vMpptMin: 200, vMpptMax: 850, iMpptMax: 26 },
  modulesInSeries: 18,
  stringsInParallel: 1,
  tMinC: -5,
  tAmbMaxC: 35,
  mounting: 'racked',
}

describe('string sizing (spec §3.3)', () => {
  it('computes the four quantities by hand', () => {
    const r = checkStringSizing(base)
    expect(r.vocCold).toBeCloseTo(49.5 * 1.081 * 18, 9) // 963.171
    expect(r.vmpHot).toBeCloseTo(41.7 * 0.8425 * 18, 9) // 632.3715
    expect(r.vmpCold).toBeCloseTo(41.7 * 1.105 * 18, 9) // 829.413
    expect(r.current).toBeCloseTo(17.375, 12)
    expect(r.ok).toBe(true)
  })

  it('19 in series breaks V_dc,max when cold (hard fail)', () => {
    const r = checkStringSizing({ ...base, modulesInSeries: 19 })
    expect(r.checks.find((c) => c.id === 'voc-cold')!.status).toBe('fail')
    expect(r.ok).toBe(false)
  })

  it('Vmp above the MPPT window when cold is a warning, not a failure', () => {
    const r = checkStringSizing({ ...base, mppt: { ...base.mppt, vMpptMax: 800 } })
    expect(r.checks.find((c) => c.id === 'vmp-cold')!.status).toBe('warn')
    expect(r.ok).toBe(true)
  })

  it('two parallel strings exceed a 26 A MPPT (2 × 13.9 × 1.25 = 34.75 A)', () => {
    expect(checkStringSizing({ ...base, stringsInParallel: 2 }).ok).toBe(false)
  })

  it('flush mounting adds 45 °C, racked 35 °C', () => {
    expect(cellTempMax(35, 'racked')).toBe(70)
    expect(cellTempMax(35, 'flush')).toBe(80)
  })

  it('recommends the largest n that passes every hard check', () => {
    const { modulesInSeries: _n, ...rest } = base
    expect(recommendedModulesInSeries(rest)).toBe(18)
    expect(recommendedModulesInSeries({ ...rest, mppt: { ...rest.mppt, vMpptMin: 5000 } })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/pv/string-sizing.test.ts`
Expected: FAIL — `Failed to resolve import "./string-sizing"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/pv/string-sizing.ts`:
```ts
/**
 * String sizing per inverter MPPT (engine spec §3.3):
 *   Voc_cold = Voc_STC × (1 + β_Voc × (T_min − 25)) × n        ≤ V_dc_max       hard fail
 *   Vmp_hot  = Vmp_STC × (1 + γ_Vmp × (T_cell_max − 25)) × n    ≥ V_mppt_min     fail
 *   Vmp_cold = Vmp_STC × (1 + γ_Vmp × (T_min − 25)) × n         ≤ V_mppt_max     warn
 *   strings_parallel × Isc_STC × 1.25                           ≤ I_mppt_max     fail
 * T_cell_max = T_amb,max + 35 °C (racked) / + 45 °C (flush).
 */

export interface StringModuleSpec {
  vocStc: number
  vmpStc: number
  iscStc: number
  /** Voc temperature coefficient, fraction per °C (negative), e.g. −0.0027. */
  betaVocPerC: number
  /** Vmp temperature coefficient, fraction per °C (negative), e.g. −0.0035. */
  gammaVmpPerC: number
}

export interface MpptSpec {
  vDcMax: number
  vMpptMin: number
  vMpptMax: number
  iMpptMax: number
}

export type Mounting = 'racked' | 'flush'

export interface StringSizingInput {
  module: StringModuleSpec
  mppt: MpptSpec
  modulesInSeries: number
  stringsInParallel: number
  tMinC: number
  tAmbMaxC: number
  mounting: Mounting
}

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface StringCheck {
  id: 'voc-cold' | 'vmp-hot' | 'vmp-cold' | 'current'
  value: number
  limit: number
  status: CheckStatus
}

export interface StringSizingResult {
  vocCold: number
  vmpHot: number
  vmpCold: number
  current: number
  checks: StringCheck[]
  /** No check failed (warnings allowed). */
  ok: boolean
}

/** Default site minimum ambient when no weather is loaded (spec §3.3). */
export const DEFAULT_T_MIN_C = { inland: -5, coastal: 0 } as const

export function cellTempMax(tAmbMaxC: number, mounting: Mounting): number {
  return tAmbMaxC + (mounting === 'racked' ? 35 : 45)
}

export function checkStringSizing(i: StringSizingInput): StringSizingResult {
  if (!Number.isInteger(i.modulesInSeries) || i.modulesInSeries < 1) throw new Error('modulesInSeries must be a positive integer')
  if (!Number.isInteger(i.stringsInParallel) || i.stringsInParallel < 1) throw new Error('stringsInParallel must be a positive integer')
  const n = i.modulesInSeries
  const tHot = cellTempMax(i.tAmbMaxC, i.mounting)
  const vocCold = i.module.vocStc * (1 + i.module.betaVocPerC * (i.tMinC - 25)) * n
  const vmpHot = i.module.vmpStc * (1 + i.module.gammaVmpPerC * (tHot - 25)) * n
  const vmpCold = i.module.vmpStc * (1 + i.module.gammaVmpPerC * (i.tMinC - 25)) * n
  const current = i.stringsInParallel * i.module.iscStc * 1.25
  const checks: StringCheck[] = [
    { id: 'voc-cold', value: vocCold, limit: i.mppt.vDcMax, status: vocCold <= i.mppt.vDcMax ? 'pass' : 'fail' },
    { id: 'vmp-hot', value: vmpHot, limit: i.mppt.vMpptMin, status: vmpHot >= i.mppt.vMpptMin ? 'pass' : 'fail' },
    { id: 'vmp-cold', value: vmpCold, limit: i.mppt.vMpptMax, status: vmpCold <= i.mppt.vMpptMax ? 'pass' : 'warn' },
    { id: 'current', value: current, limit: i.mppt.iMpptMax, status: current <= i.mppt.iMpptMax ? 'pass' : 'fail' },
  ]
  return { vocCold, vmpHot, vmpCold, current, checks, ok: checks.every((c) => c.status !== 'fail') }
}

/** Largest modules-in-series that passes every hard check, or null if none does (spec §3.3). */
export function recommendedModulesInSeries(i: Omit<StringSizingInput, 'modulesInSeries'>, maxN = 200): number | null {
  for (let n = maxN; n >= 1; n--) {
    if (checkStringSizing({ ...i, modulesInSeries: n }).ok) return n
  }
  return null
}
```

Append to `index.ts`:
```ts
export * from './pv/string-sizing'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/pv/string-sizing.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/pv/string-sizing.ts packages/shared/src/services/solar/pv/string-sizing.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): string sizing checks and recommended modules-in-series (§3.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: PVGIS fixtures — weather files, loader, reference yields

**Files:**
- Create: `packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs`
- Generate: `packages/shared/src/services/solar/__fixtures__/pvgis/tmy_{jhb,pta,cpt,dbn,upt}.csv.gz`
- Create: `packages/shared/src/services/solar/__fixtures__/pvgis.ts`

No test of its own: its consumers are Tasks 12–13, and the loader refuses any fixture whose content does not match its pinned SHA-256.

- [ ] **Step 1: Add the fetch script**

`packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs`:
```js
#!/usr/bin/env node
// Fetches the PVGIS 5.2 fixtures for the solar engine validation (engine spec §3.7, D-19).
//
//   node packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs               # TMY weather → __fixtures__/pvgis/*.csv.gz
//   node packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs --references  # also recompute the reference yields (~10 min)
//
// Each TMY response's SHA-256 must equal the value pinned in __fixtures__/pvgis.ts; the script
// refuses to write a file that differs (PVGIS republished its data — re-validate before re-pinning).
import { mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://re.jrc.ec.europa.eu/api/v5_2'
const SITES = {
  jhb: { lat: -26.2, lon: 28.05, sha: '39dfa9292884b4e52df79ecaef77e7efe4d7b8a1bd4434b1ba7b3ddd75714d6d' },
  pta: { lat: -25.75, lon: 28.19, sha: '51e1301a1cf40c22f025b9d3c4961a9c93a4439526bfc91c708cb0a0a657e4c0' },
  cpt: { lat: -33.92, lon: 18.42, sha: '2051ba13d488ba27bd08408e692906d4d9e5984e2bf0d8f020233e067dfc0f29' },
  dbn: { lat: -29.86, lon: 31.02, sha: '3c676fa3273b00a146c54ae1681e44730c4308e0571ee77295554b6c73566eee' },
  upt: { lat: -28.45, lon: 21.26, sha: 'd86320b8c1688f26a13a60ee2973cb71c668e9282f0b96bbf237bbef80bf57d8' },
}
// [key, tilt, PVGIS aspect (0 = south, 90 = west, −90 = east, 180 = north)]
const CASES = [['n30', 30, 180], ['n15', 15, 180], ['e10', 10, -90], ['w10', 10, 90]]
const COMMON = 'peakpower=1&loss=10.05&mountingplace=free&pvtechchoice=crystSi&raddatabase=PVGIS-SARAH2&usehorizon=1&outputformat=json'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/services/solar/__fixtures__/pvgis')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, as = 'text') {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return as === 'json' ? res.json() : res.text()
      console.error(`HTTP ${res.status} (attempt ${attempt}) ${url}`)
    } catch (e) {
      console.error(`${e.message} (attempt ${attempt}) ${url}`)
    }
    await sleep(3000)
  }
  throw new Error(`gave up on ${url}`)
}

mkdirSync(outDir, { recursive: true })
const monthsBySite = {}
for (const [key, s] of Object.entries(SITES)) {
  const text = await get(`${API}/tmy?lat=${s.lat}&lon=${s.lon}&outputformat=csv`)
  const sha = createHash('sha256').update(text, 'utf8').digest('hex')
  if (sha !== s.sha) throw new Error(`${key}: TMY SHA-256 ${sha} ≠ pinned ${s.sha}. PVGIS data changed — stop and re-validate.`)
  writeFileSync(join(outDir, `tmy_${key}.csv.gz`), gzipSync(Buffer.from(text, 'utf8'), { level: 9 }))
  const lines = text.split(/\r?\n/)
  const i0 = lines.findIndex((l) => l.startsWith('month,year'))
  monthsBySite[key] = Object.fromEntries(lines.slice(i0 + 1, i0 + 13).map((l) => l.split(',').map(Number)))
  console.log(`${key}: ok ${sha}`)
}

if (process.argv.includes('--references')) {
  const out = {}
  for (const [key, s] of Object.entries(SITES)) {
    out[key] = {}
    const years = [...new Set(Object.values(monthsBySite[key]))]
    for (const [c, tilt, aspect] of CASES) {
      const pvcalc = await get(`${API}/PVcalc?lat=${s.lat}&lon=${s.lon}&angle=${tilt}&aspect=${aspect}&${COMMON}`, 'json')
      let tmyKwh = 0
      for (const y of years) {
        const sc = await get(
          `${API}/seriescalc?lat=${s.lat}&lon=${s.lon}&startyear=${y}&endyear=${y}&pvcalculation=1&angle=${tilt}&aspect=${aspect}&${COMMON}`,
          'json',
        )
        for (const r of sc.outputs.hourly) {
          const m = +r.time.slice(4, 6)
          const d = +r.time.slice(6, 8)
          if (monthsBySite[key][m] !== y || (m === 2 && d === 29)) continue
          tmyKwh += r.P / 1000
        }
        await sleep(500)
      }
      out[key][c] = { pvcalcEy: pvcalc.outputs.totals.fixed.E_y, tmyMonths: Math.round(tmyKwh * 100) / 100 }
      console.log(key, c, out[key][c])
    }
  }
  console.log(JSON.stringify(out, null, 2))
}
```

- [ ] **Step 2: Fetch the weather fixtures**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-4a
node packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs
ls -la packages/shared/src/services/solar/__fixtures__/pvgis
```
Expected: five `<site>: ok <sha>` lines matching the pinned SHAs; five `.csv.gz` files of ~160–170 kB each. If a SHA mismatches, STOP and report (PVGIS republished — the references below would need re-fetching with `--references` and the table in this plan re-checked).

- [ ] **Step 3: Create the loader and the reference constants**

`packages/shared/src/services/solar/__fixtures__/pvgis.ts`:
```ts
/**
 * PVGIS 5.2 fixtures for the engine validation (spec §3.7, D-19 — public references only).
 * Test-only: excluded from the package type-check (it reads files with node:fs / node:zlib).
 *
 * Weather: the verbatim `tmy` CSV response per site, gzipped. Fetched 2026-09-28 with
 *   https://re.jrc.ec.europa.eu/api/v5_2/tmy?lat=<lat>&lon=<lon>&outputformat=csv
 * The SHA-256 of each UNCOMPRESSED response is pinned below; the fixture loader refuses a file
 * whose content does not match (PVGIS republished data or the file was edited).
 * Data © European Union (JRC PVGIS), reusable with acknowledgement (Commission Decision 2011/833/EU).
 *
 * Regenerate / re-check: `node packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs`.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { parsePvgisTmyCsv } from '../weather/pvgis-tmy'
import { tmyToReferenceYear, type WeatherYear } from '../weather/reference-year'

export type SiteKey = 'jhb' | 'pta' | 'cpt' | 'dbn' | 'upt'
export type OrientationKey = 'n30' | 'n15' | 'ew10'

export const SITES: Record<SiteKey, { name: string; lat: number; lon: number; tmySha256: string }> = {
  jhb: { name: 'Johannesburg', lat: -26.2, lon: 28.05, tmySha256: '39dfa9292884b4e52df79ecaef77e7efe4d7b8a1bd4434b1ba7b3ddd75714d6d' },
  pta: { name: 'Pretoria', lat: -25.75, lon: 28.19, tmySha256: '51e1301a1cf40c22f025b9d3c4961a9c93a4439526bfc91c708cb0a0a657e4c0' },
  cpt: { name: 'Cape Town', lat: -33.92, lon: 18.42, tmySha256: '2051ba13d488ba27bd08408e692906d4d9e5984e2bf0d8f020233e067dfc0f29' },
  dbn: { name: 'Durban', lat: -29.86, lon: 31.02, tmySha256: '3c676fa3273b00a146c54ae1681e44730c4308e0571ee77295554b6c73566eee' },
  upt: { name: 'Upington', lat: -28.45, lon: 21.26, tmySha256: 'd86320b8c1688f26a13a60ee2973cb71c668e9282f0b96bbf237bbef80bf57d8' },
}

/**
 * Loss inputs used IDENTICALLY on both sides. Engine: the spec §7 defaults with shading 0
 * (PVGIS models the horizon itself) and a flat 97.5 % inverter. PVGIS `loss` = 1 − Π(1 − l_i)
 * of the same chain = 1 − 0.98·0.99·0.985·0.985·0.975·0.99·0.99 = 10.05 %.
 */
export const PVGIS_LOSS_PERCENT = 10.05

/**
 * PRIMARY reference (the ±3 % gate): PVGIS's own PV model (`seriescalc`, `pvcalculation=1` — the
 * same model PVcalc runs) summed over exactly the months the TMY drew from each source year,
 * 29 February excluded. Same weather on both sides, so only the MODEL is compared.
 *   https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?lat=<lat>&lon=<lon>&startyear=<y>&endyear=<y>
 *     &pvcalculation=1&peakpower=1&loss=10.05&angle=<tilt>&aspect=<aspect>&mountingplace=free
 *     &pvtechchoice=crystSi&raddatabase=PVGIS-SARAH2&usehorizon=1&outputformat=json
 * PVGIS aspect: 0 = south, 90 = west, −90 = east, 180 = north. East–west = mean of the two halves.
 * kWh/kWp/yr.
 */
export const PVGIS_TMY_MONTHS_REFERENCE: Record<SiteKey, Record<OrientationKey, number>> = {
  jhb: { n30: 1821.02, n15: 1767.87, ew10: (1608.16 + 1602.28) / 2 },
  pta: { n30: 1756.05, n15: 1716.61, ew10: (1575.45 + 1576.59) / 2 },
  cpt: { n30: 1732.35, n15: 1692.9, ew10: (1544.16 + 1551.38) / 2 },
  dbn: { n30: 1466.71, n15: 1424.39, ew10: (1286.91 + 1306.85) / 2 },
  upt: { n30: 1939.11, n15: 1887.79, ew10: (1719.92 + 1714.05) / 2 },
}

/**
 * PVcalc long-term E_y (2005–2020 SARAH2 mean), fetched 2026-09-28:
 *   https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?lat=<lat>&lon=<lon>&peakpower=1&loss=10.05&angle=<tilt>
 *     &aspect=<aspect>&mountingplace=free&pvtechchoice=crystSi&raddatabase=PVGIS-SARAH2&usehorizon=1
 *     &outputformat=json          → outputs.totals.fixed.E_y
 * These differ from the TMY-months reference by the TMY's own representativeness (Durban's TMY
 * GHI is 3.7 % below its 16-year mean), so they are checked at ±5 %, not gated at ±3 %.
 */
export const PVCALC_LONG_TERM_EY: Record<SiteKey, Record<OrientationKey, number>> = {
  jhb: { n30: 1835.61, n15: 1786.17, ew10: (1635.11 + 1617.99) / 2 },
  pta: { n30: 1815.17, n15: 1767.89, ew10: (1613 + 1615.7) / 2 },
  cpt: { n30: 1761.11, n15: 1716.09, ew10: (1553.25 + 1573.65) / 2 },
  dbn: { n30: 1558.08, n15: 1505.02, ew10: (1354.51 + 1365.43) / 2 },
  upt: { n30: 1979.65, n15: 1925.61, ew10: (1752.3 + 1745.91) / 2 },
}

/** WM Solar's static curve: ≈ 2,346 kWh/kWp regardless of site or orientation. */
export const WM_STATIC_SPECIFIC_YIELD = 2346

export function loadTmyCsv(site: SiteKey): string {
  const gz = readFileSync(new URL(`./pvgis/tmy_${site}.csv.gz`, import.meta.url))
  const text = gunzipSync(gz).toString('utf8')
  const sha = createHash('sha256').update(text, 'utf8').digest('hex')
  if (sha !== SITES[site].tmySha256) throw new Error(`fixture tmy_${site}.csv.gz does not match its pinned SHA-256 (${sha})`)
  return text
}

export function loadWeather(site: SiteKey): WeatherYear {
  return tmyToReferenceYear(parsePvgisTmyCsv(loadTmyCsv(site)))
}
```

- [ ] **Step 4: Prove the loader reads and parses every site**

Run:
```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-4a/packages/shared
cat > src/services/solar/fixtures-smoke.test.ts <<'EOF'
import { it, expect } from 'vitest'
import { loadWeather, SITES, type SiteKey } from './__fixtures__/pvgis'
it('loads every fixture', () => {
  for (const s of Object.keys(SITES) as SiteKey[]) expect(loadWeather(s).ghi.length).toBe(8760)
})
EOF
pnpm exec vitest run src/services/solar/fixtures-smoke.test.ts 2>&1 | tail -4
rm src/services/solar/fixtures-smoke.test.ts
```
Expected: 1 passed. (Throwaway smoke test — deleted, never committed.)

- [ ] **Step 5: Commit**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-4a
git add packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs packages/shared/src/services/solar/__fixtures__
git commit -m "$(cat <<'EOF'
test(solar-engine): PVGIS 5.2 TMY fixtures (5 SA sites) + reference yields

Verbatim tmy CSV responses, gzipped, SHA-256 pinned. Reference yields recorded at
planning time with their exact queries: PVGIS seriescalc over the TMY months (the
±3 % gate) and PVcalc long-term E_y (±5 % check). Data © EU (JRC PVGIS).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Hourly PV simulation and KPIs

**Files:**
- Create: `packages/shared/src/services/solar/pv/simulate-pv.ts`
- Test: `packages/shared/src/services/solar/pv/simulate-pv.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/pv/simulate-pv.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { loadWeather } from '../__fixtures__/pvgis'
import { recentre, simulatePv, sunPath, type PvArray, type PvSystem } from './simulate-pv'
import { monthlySums } from '../time'

const weather = loadWeather('jhb')
const sun = sunPath(weather)

const array = (over: Partial<PvArray> = {}): PvArray => ({
  id: 'a',
  kWpDc: 100,
  tiltDeg: 30,
  azimuthDeg: 0,
  module: { gammaPmaxPerC: -0.0035, iamB0: 0.05 },
  cellTemp: { kind: 'noct', noctC: 45 },
  losses: { soiling: 0.02, shading: 0.01, mismatch: 0.01, dcWiring: 0.015, lid: 0.015, nameplate: 0 },
  inverterId: 'inv',
  ...over,
})
const system = (over: Partial<PvSystem> = {}): PvSystem => ({
  arrays: [array()],
  inverters: [{ id: 'inv', acRatedKw: 1000 }],
  acLosses: { acWiring: 0.01, availability: 0.99 },
  albedo: 0.2,
  transposition: 'perez',
  ...over,
})

describe('recentre', () => {
  it('preserves the total exactly and moves a spike by (0.5 − offset) of an hour', () => {
    const s = new Float64Array(8760)
    s[100] = 10
    const r = recentre(s, 0.05)
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 12)
    expect(r[99]).toBeCloseTo(4.5, 12) // hour 99's centre (99.5) is 0.55 h before the sample at 100.05
    expect(r[100]).toBeCloseTo(5.5, 12)
  })
})

describe('simulatePv on the Johannesburg TMY', () => {
  const r = simulatePv(weather, system(), sun)

  it('gives a plausible specific yield and PR for a north-facing 30° array', () => {
    expect(r.annual.specificYield).toBeGreaterThan(1700)
    expect(r.annual.specificYield).toBeLessThan(1900)
    expect(r.annual.performanceRatio).toBeGreaterThan(0.75)
    expect(r.annual.performanceRatio).toBeLessThan(0.85)
  })

  it('peaks at SAST solar noon (≈ 12:00–13:00), not two hours early', () => {
    const byHour = new Array(24).fill(0)
    for (let h = 0; h < 8760; h++) byHour[h % 24] += r.pAc[h]!
    const peak = byHour.indexOf(Math.max(...byHour))
    expect([11, 12]).toContain(peak)
  })

  it('is linear in kWp when nothing clips', () => {
    const r2 = simulatePv(weather, system({ arrays: [array({ kWpDc: 200 })] }), sun)
    expect(r2.annual.acKwh).toBeCloseTo(2 * r.annual.acKwh, 6)
  })

  it('clips at the inverter AC rating and never exceeds it after AC losses', () => {
    const c = simulatePv(weather, system({ inverters: [{ id: 'inv', acRatedKw: 50 }] }), sun)
    expect(c.annual.clippedKwh).toBeGreaterThan(0)
    expect(Math.max(...c.pAc)).toBeLessThanOrEqual(50 * 0.99 * 0.99 + 1e-9)
    expect(c.annual.acKwh).toBeLessThan(r.annual.acKwh)
  })

  it('winter (June) yields less than summer for a flat-ish array but more for a steep north array', () => {
    const flat = monthlySums(simulatePv(weather, system({ arrays: [array({ tiltDeg: 5 })] }), sun).pAc)
    const steep = monthlySums(simulatePv(weather, system({ arrays: [array({ tiltDeg: 60 })] }), sun).pAc)
    expect(flat[5]!).toBeLessThan(flat[11]!)
    expect(steep[5]!).toBeGreaterThan(steep[11]!)
  })

  it('Hay–Davies is a working fallback within 3 % of Perez', () => {
    const h = simulatePv(weather, system({ transposition: 'hay-davies' }), sun)
    expect(Math.abs(h.annual.acKwh / r.annual.acKwh - 1)).toBeLessThan(0.03)
  })

  it('Faiman is a working alternative to NOCT within 3 %', () => {
    const f = simulatePv(weather, system({ arrays: [array({ cellTemp: { kind: 'faiman', u0: 25, u1: 6.84 } })] }), sun)
    expect(Math.abs(f.annual.acKwh / r.annual.acKwh - 1)).toBeLessThan(0.03)
  })

  it('re-centres output on the hour midpoint: one sunny sample splits 0.45 / 0.55 across two hours', () => {
    const one = (v: number) => {
      const a = new Float64Array(8760)
      a[4332] = v // 30 Jun, 12:00–13:00 SAST
      return a
    }
    const w = { ...weather, sampleOffsetH: 0.05, ghi: one(600), dni: one(800), dhi: one(100), tAmb: new Float64Array(8760).fill(15) }
    const s = simulatePv(w, system(), sunPath(w))
    expect(s.pAc[4331]! / (s.pAc[4331]! + s.pAc[4332]!)).toBeCloseTo(0.45, 9)
    expect(s.pAc[4330]).toBe(0)
    expect(s.pAc[4333]).toBe(0)
  })

  it('refuses an array wired to an unknown inverter, an empty system and a bad albedo', () => {
    expect(() => simulatePv(weather, system({ arrays: [array({ inverterId: 'nope' })] }), sun)).toThrow(/unknown inverter nope/)
    expect(() => simulatePv(weather, system({ arrays: [] }), sun)).toThrow(/no arrays/)
    expect(() => simulatePv(weather, system({ albedo: 20 }), sun)).toThrow(/albedo/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/pv/simulate-pv.test.ts`
Expected: FAIL — `Failed to resolve import "./simulate-pv"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/pv/simulate-pv.ts`:
```ts
/**
 * Hourly PV simulation (engine spec §3.4–3.5, §4 KPIs).
 *
 * Per hour the sun is placed at the irradiance SAMPLE instant (SAST hour start + the weather's
 * sampleOffsetH), POA and power are computed there, and the resulting series are then linearly
 * re-centred onto the hour midpoint so `pAc[h]` is the mean over [h, h+1) like every other
 * engine series. Re-centring is circular and weight-preserving, so annual totals are unchanged.
 */
import { solarPosition } from '../solar-position/spa'
import {
  beamOnPlane,
  cosAoi,
  extraterrestrialDni,
  groundReflected,
  hayDaviesSkyDiffuse,
  perezSkyDiffuse,
  relativeAirmass,
} from '../irradiance/transposition'
import { ashraeIam, groundEquivalentAoi, skyDiffuseEquivalentAoi } from '../irradiance/iam'
import { cellTemperature, type CellTempModel } from './cell-temperature'
import { acFactor, combinedDcLoss, type AcLosses, type DcLosses } from './losses'
import { inverterOutput, validateCurve, type InverterSpec } from './inverter'
import { HOURS_PER_YEAR, sastHourStartUtcMs, sum } from '../time'
import type { WeatherYear } from '../weather/reference-year'

export interface ModuleSpec {
  /** Pmax temperature coefficient per °C, e.g. −0.0035. */
  gammaPmaxPerC: number
  /** ASHRAE IAM b0, default 0.05. */
  iamB0: number
}

export interface PvArray {
  id: string
  kWpDc: number
  tiltDeg: number
  /** 0 = north, 90 = east, 180 = south, 270 = west. */
  azimuthDeg: number
  module: ModuleSpec
  cellTemp: CellTempModel
  losses: DcLosses
  inverterId: string
}

export interface PvSystem {
  arrays: PvArray[]
  inverters: InverterSpec[]
  acLosses: AcLosses
  albedo: number
  transposition: 'perez' | 'hay-davies'
}

export interface PvSeries {
  /** AC output after inverter, AC wiring and availability, kW (= kWh in the hour). */
  pAc: Float64Array
  /** DC output after the DC loss chain, kW. */
  pDc: Float64Array
  /** Inverter clipping, kW. */
  clipped: Float64Array
}

export interface PvResult extends PvSeries {
  kWpDc: number
  annual: {
    acKwh: number
    dcKwh: number
    clippedKwh: number
    /** Σ_arrays kWp_a × ΣPOA_a / 1000 — the reference yield denominator of PR, kWh. */
    referenceKwh: number
    specificYield: number
    performanceRatio: number
  }
}

interface SunHour {
  zenith: number
  azimuth: number
  dniExtra: number
  airmass: number
}

/** Solar position at every irradiance sample instant — shared by all arrays of one run. */
export function sunPath(w: WeatherYear): SunHour[] {
  const out: SunHour[] = new Array(HOURS_PER_YEAR)
  const offsetMs = w.sampleOffsetH * 3_600_000
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const t = sastHourStartUtcMs(h) + offsetMs
    const p = solarPosition(t, w.latitude, w.longitude, {
      elevationM: w.elevation,
      pressureHpa: w.pressure[h]!,
      temperatureC: w.tAmb[h]!,
    })
    const doy = Math.floor(h / 24) + 1
    out[h] = { zenith: p.zenith, azimuth: p.azimuth, dniExtra: extraterrestrialDni(doy), airmass: relativeAirmass(p.zenith) }
  }
  return out
}

function validate(sys: PvSystem): void {
  if (sys.arrays.length === 0) throw new Error('PV system has no arrays')
  if (!(sys.albedo >= 0 && sys.albedo <= 1)) throw new Error(`albedo must be in [0, 1], got ${sys.albedo}`)
  const ids = new Set(sys.inverters.map((i) => i.id))
  for (const inv of sys.inverters) {
    if (!(inv.acRatedKw > 0)) throw new Error(`inverter ${inv.id}: acRatedKw must be > 0`)
    if (inv.efficiencyCurve) validateCurve(inv.efficiencyCurve)
  }
  for (const a of sys.arrays) {
    if (!(a.kWpDc > 0)) throw new Error(`array ${a.id}: kWpDc must be > 0`)
    if (!(a.tiltDeg >= 0 && a.tiltDeg <= 90)) throw new Error(`array ${a.id}: tilt must be 0–90°`)
    if (!ids.has(a.inverterId)) throw new Error(`array ${a.id}: unknown inverter ${a.inverterId}`)
  }
}

/** Re-centre a series sampled at h + offset onto h + 0.5 (linear, circular). */
export function recentre(sampled: Float64Array, offsetH: number): Float64Array {
  const n = sampled.length
  const out = new Float64Array(n)
  const shift = 0.5 - offsetH
  const k0 = Math.floor(shift)
  const frac = shift - k0
  for (let h = 0; h < n; h++) {
    const a = sampled[(((h + k0) % n) + n) % n]!
    const b = sampled[(((h + k0 + 1) % n) + n) % n]!
    out[h] = (1 - frac) * a + frac * b
  }
  return out
}

export function simulatePv(w: WeatherYear, sys: PvSystem, sun: SunHour[] = sunPath(w)): PvResult {
  validate(sys)
  const dcByInverter = new Map<string, Float64Array>(sys.inverters.map((i) => [i.id, new Float64Array(HOURS_PER_YEAR)]))
  let referenceKwh = 0
  let kWpDc = 0

  for (const a of sys.arrays) {
    kWpDc += a.kWpDc
    const keep = 1 - combinedDcLoss(a.losses)
    const iamSky = ashraeIam(skyDiffuseEquivalentAoi(a.tiltDeg), a.module.iamB0)
    const iamGnd = ashraeIam(groundEquivalentAoi(a.tiltDeg), a.module.iamB0)
    const dc = dcByInverter.get(a.inverterId)!
    let poaSum = 0
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
      const s = sun[h]!
      const ca = cosAoi(a.tiltDeg, a.azimuthDeg, s.zenith, s.azimuth)
      const beam = beamOnPlane(w.dni[h]!, ca, s.zenith)
      const skyIn = { tiltDeg: a.tiltDeg, cosAoi: ca, zenithDeg: s.zenith, dni: w.dni[h]!, dhi: w.dhi[h]!, dniExtra: s.dniExtra, airmass: s.airmass }
      const sky = sys.transposition === 'perez' ? perezSkyDiffuse(skyIn) : hayDaviesSkyDiffuse(skyIn)
      const gnd = groundReflected(w.ghi[h]!, sys.albedo, a.tiltDeg)
      const poa = beam + sky + gnd
      if (poa <= 0) continue
      poaSum += poa
      const aoiDeg = (Math.acos(Math.max(-1, Math.min(1, ca))) * 180) / Math.PI
      const poaEff = beam * ashraeIam(aoiDeg, a.module.iamB0) + sky * iamSky + gnd * iamGnd
      const tCell = cellTemperature(a.cellTemp, w.tAmb[h]!, poa, w.wind[h]!)
      const p = a.kWpDc * (poaEff / 1000) * (1 + a.module.gammaPmaxPerC * (tCell - 25)) * keep
      dc[h] += Math.max(0, p)
    }
    referenceKwh += (a.kWpDc * poaSum) / 1000
  }

  const acMult = acFactor(sys.acLosses)
  const pDcS = new Float64Array(HOURS_PER_YEAR)
  const pAcS = new Float64Array(HOURS_PER_YEAR)
  const clipS = new Float64Array(HOURS_PER_YEAR)
  for (const inv of sys.inverters) {
    const dc = dcByInverter.get(inv.id)!
    const invSpec = { ...inv, dcRatedKw: inv.dcRatedKw ?? inv.acRatedKw }
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
      if (dc[h]! <= 0) continue
      const o = inverterOutput(dc[h]!, invSpec)
      pDcS[h] += dc[h]!
      pAcS[h] += o.pAcKw * acMult
      clipS[h] += o.clippedKw
    }
  }

  const pAc = recentre(pAcS, w.sampleOffsetH)
  const pDc = recentre(pDcS, w.sampleOffsetH)
  const clipped = recentre(clipS, w.sampleOffsetH)
  const acKwh = sum(pAc)
  return {
    pAc,
    pDc,
    clipped,
    kWpDc,
    annual: {
      acKwh,
      dcKwh: sum(pDc),
      clippedKwh: sum(clipped),
      referenceKwh,
      specificYield: acKwh / kWpDc,
      performanceRatio: referenceKwh > 0 ? acKwh / referenceKwh : 0,
    },
  }
}
```

Append to `index.ts`:
```ts
export * from './pv/simulate-pv'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/pv/simulate-pv.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Prove the re-centring test can fail**

Temporarily replace `const pAc = recentre(pAcS, w.sampleOffsetH)` with `const pAc = pAcS` in `simulate-pv.ts`, run the same command, and confirm exactly 1 failure (`re-centres output on the hour midpoint`). Restore the line and confirm 10 passed again. (Annual totals cannot catch this mutation by design — this test is the only guard.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/services/solar/pv/simulate-pv.ts packages/shared/src/services/solar/pv/simulate-pv.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): hourly PV simulation with specific yield, PR and clipping

Sun placed at the PVGIS irradiance sample instant, output re-centred on the hour
midpoint (weight-preserving). Arrays aggregate per inverter before efficiency and
clipping; losses multiplicative; degradation deliberately NOT applied here (§3.6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: PVGIS validation gate and regression guards (spec §3.7)

**Files:**
- Test: `packages/shared/src/services/solar/pvgis-validation.test.ts`

This task adds tests only — the engine it validates exists. So the "red" step is proven by mutation (Step 3), not by a missing import.

- [ ] **Step 1: Write the validation test**

`packages/shared/src/services/solar/pvgis-validation.test.ts`:
```ts
/**
 * Engine validation against PVGIS (engine spec §3.7, D-19): 5 SA sites × 3 orientations,
 * identical loss inputs, ±3 % on specific yield. Plus the two regression guards that prove the
 * test can fail: WM Solar's static curve, and WM's un-shifted UTC weather.
 */
import { describe, expect, it } from 'vitest'
import {
  PVCALC_LONG_TERM_EY,
  PVGIS_TMY_MONTHS_REFERENCE,
  SITES,
  WM_STATIC_SPECIFIC_YIELD,
  loadWeather,
  type OrientationKey,
  type SiteKey,
} from './__fixtures__/pvgis'
import { simulatePv, sunPath, type PvArray, type PvSystem } from './pv/simulate-pv'
import type { WeatherYear } from './weather/reference-year'

const LOSSES = { soiling: 0.02, shading: 0, mismatch: 0.01, dcWiring: 0.015, lid: 0.015, nameplate: 0 }

function arr(id: string, kWp: number, tilt: number, az: number): PvArray {
  return {
    id,
    kWpDc: kWp,
    tiltDeg: tilt,
    azimuthDeg: az,
    module: { gammaPmaxPerC: -0.0035, iamB0: 0.05 },
    cellTemp: { kind: 'noct', noctC: 45 },
    losses: LOSSES,
    inverterId: 'inv',
  }
}

const ORIENTATIONS: Record<OrientationKey, PvArray[]> = {
  n30: [arr('n', 1, 30, 0)],
  n15: [arr('n', 1, 15, 0)],
  ew10: [arr('e', 0.5, 10, 90), arr('w', 0.5, 10, 270)],
}

function system(arrays: PvArray[]): PvSystem {
  return {
    arrays,
    inverters: [{ id: 'inv', acRatedKw: 10 }], // oversized: no clipping, as in PVGIS
    acLosses: { acWiring: 0.01, availability: 0.99 },
    albedo: 0.2,
    transposition: 'perez',
  }
}

const SITE_KEYS = Object.keys(SITES) as SiteKey[]
const ORIENT_KEYS = Object.keys(ORIENTATIONS) as OrientationKey[]

/** Returns every (site, orientation) whose yield is outside ±tol of the reference. */
function failures(
  yieldOf: (site: SiteKey, o: OrientationKey) => number,
  ref: Record<SiteKey, Record<OrientationKey, number>>,
  tol: number,
): string[] {
  const out: string[] = []
  for (const s of SITE_KEYS) {
    for (const o of ORIENT_KEYS) {
      const dev = yieldOf(s, o) / ref[s][o] - 1
      if (Math.abs(dev) > tol) out.push(`${s}/${o} ${(dev * 100).toFixed(2)} %`)
    }
  }
  return out
}

const weathers = Object.fromEntries(SITE_KEYS.map((s) => [s, loadWeather(s)])) as Record<SiteKey, WeatherYear>

const engineYield = (() => {
  const cache = new Map<string, number>()
  return (s: SiteKey, o: OrientationKey) => {
    const k = `${s}/${o}`
    if (!cache.has(k)) cache.set(k, simulatePv(weathers[s], system(ORIENTATIONS[o])).annual.specificYield)
    return cache.get(k)!
  }
})()

describe('PVGIS validation (spec §3.7)', () => {
  it('engine specific yield is within ±3 % of PVGIS on the same TMY months — all 15 cases', () => {
    expect(failures(engineYield, PVGIS_TMY_MONTHS_REFERENCE, 0.03)).toEqual([])
  })

  it('and within ±5 % of the PVcalc 2005–2020 long-term E_y (the TMY is one sample of it)', () => {
    expect(failures(engineYield, PVCALC_LONG_TERM_EY, 0.05)).toEqual([])
  })

  it('REGRESSION GUARD: WM Solar\'s static 2,346 kWh/kWp fails every one of the 15 cases', () => {
    const wm = () => WM_STATIC_SPECIFIC_YIELD
    expect(failures(wm, PVGIS_TMY_MONTHS_REFERENCE, 0.03)).toHaveLength(15)
    expect(failures(wm, PVCALC_LONG_TERM_EY, 0.03)).toHaveLength(15)
  })

  it('REGRESSION GUARD: weather used in UTC without the +2 h shift (WM\'s bug) fails every case', () => {
    const rot = (a: Float64Array) => Float64Array.from(a, (_, h) => a[(h + 2) % a.length]!)
    const unshifted = (s: SiteKey, o: OrientationKey) => {
      const w = weathers[s]
      const bad: WeatherYear = { ...w, ghi: rot(w.ghi), dni: rot(w.dni), dhi: rot(w.dhi), tAmb: rot(w.tAmb), wind: rot(w.wind), pressure: rot(w.pressure) }
      return simulatePv(bad, system(ORIENTATIONS[o]), sunPath(bad)).annual.specificYield
    }
    expect(failures(unshifted, PVGIS_TMY_MONTHS_REFERENCE, 0.03)).toHaveLength(15)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/pvgis-validation.test.ts`
Expected: 4 passed. If the first test fails, the failure message lists every case outside ±3 % — compare against the planning table above; do NOT adjust module parameters or tolerances. Report the list.

- [ ] **Step 3: Prove the gate can fail (mutation), then restore**

In `pv/simulate-pv.ts` temporarily replace `beam * ashraeIam(aoiDeg, a.module.iamB0)` with `beam` (drop beam IAM), re-run Step 2's command, and confirm the first test FAILS with a non-empty list of cases. Restore the expression and confirm 4 passed. Record the failing list in the PR body ("gate mutation-proven: dropping beam IAM → N cases out of ±3 %").

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/services/solar/pvgis-validation.test.ts
git commit -m "$(cat <<'EOF'
test(solar-engine): PVGIS validation gate — 5 SA sites × 3 orientations within ±3 %

Gate: PVGIS's PV model over the exact TMY months (same weather → model-only compare).
Also within ±5 % of PVcalc long-term E_y. Regression guards: WM's static 2,346
kWh/kWp and WM's un-shifted UTC weather each fail all 15 cases. Gate mutation-proven.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Full verification, push, draft PR

**Files:** none (PR body in a temp file)

- [ ] **Step 1: Whole solar-engine directory**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar`
Expected: 11 files, **67 tests** passed.

- [ ] **Step 2: Three suites, type-check, lint**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-4a
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter @esite/shared type-check
pnpm --filter @esite/shared lint 2>&1 | tail -5
```
Expected: shared = baseline + 67; web and db equal to the Task 1 baseline; type-check exit 0; lint shows no errors (warnings allowed only if they pre-existed at baseline).

- [ ] **Step 3: Confirm nothing outside scope changed**

Run: `git diff --stat origin/feat/solar-phase-1a...HEAD`
Expected: only `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/scripts/solar/*`, `packages/shared/src/services/solar/**`. No migration files.

- [ ] **Step 4: Push**

```bash
git push -u origin feat/solar-phase-4a
```
If `origin` is an HTTPS URL and the push is refused, push over SSH instead: `git push -u git@github.com:WattMatt/e-site.git feat/solar-phase-4a`.

- [ ] **Step 5: Open the DRAFT PR against the Phase 1a branch**

```bash
cat > /tmp/pr-solar-4a.md <<'EOF'
## Solar Phase 4a — calculation engine (part i: weather, solar geometry, PV model, PVGIS validation)

Pure TypeScript in `packages/shared/src/services/solar/`, exported as `@esite/shared/solar-engine`. No I/O, no migration.
Plans: `docs/superpowers/plans/2026-09-28-solar-phase-4a-engine-i-pv.md` (this part) and `…-4a-engine-ii-balance-finance.md` (battery, energy balance, finance — lands on this same branch next).

### What is in part i
- PVGIS 5.2 TMY parser (JSON + CSV), UTC→SAST +2 h, 29 Feb dropped, 8760 reference year (spec §1.2)
- NREL SPA (ported from pvlib, BSD-3; tables generated from a pinned commit), Perez 1990 + Hay–Davies, albedo, ASHRAE IAM
- NOCT / Faiman cell temperature, multiplicative loss chain, inverter efficiency curve + clipping, string-sizing checks (§3.3)
- Hourly PV simulation → specific yield, PR, clipping; degradation deliberately NOT applied here (§3.6 — once, in the cashflow)
- `inputs_hash` = SHA-256 of canonical JSON (pure TS, verified against node:crypto); `ENGINE_VERSION` 0.1.0

### Validation (spec §3.7, D-19 — public references only)
- **Gate:** engine within ±3 % of PVGIS's PV model over the TMY's own months, 5 sites × 3 orientations — all 15 pass (planning run: +0.27 % … +1.80 %).
- PVcalc long-term E_y (recorded with exact queries): within ±5 %. Durban is −4.4 % against it because its TMY GHI is 3.7 % below the 16-year mean — see open question Q2.
- WM Solar's static 2,346 kWh/kWp fails all 15. Weather used un-shifted in UTC (WM's bug) fails all 15.
- Gate mutation-proven: <paste Task 13 Step 3 result>.

### Suites
- shared: <baseline> → <after>; web: <n> (unchanged); db: <n> (unchanged); type-check clean; lint clean.

### Open questions for the owner
- Q1 — solar position at the irradiance sample instant + re-centring, instead of "at the hour midpoint" (§3.4).
- Q2 — make the §3.7 gate "±3 % vs PVGIS on the same TMY months" (as built) rather than "vs PVcalc long-term".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
gh pr create --draft --base feat/solar-phase-1a --head feat/solar-phase-4a \
  --title "Solar Phase 4a: calculation engine (PV model + PVGIS validation; battery/finance follows)" \
  --body-file /tmp/pr-solar-4a.md
```
Before running, replace every `<…>` in the body with the real numbers from Steps 1–2 and Task 13 Step 3. Expected: a draft PR URL. Record it — Phase 4a-ii updates this PR.

- [ ] **Step 6: Hand-off**

Report: the PR URL, test counts, the Task 13 mutation result, and that Phase 4a-ii continues on the same branch and worktree.

---

## Open questions (for the owner — none block this plan)

- **Q1 (spec §3.4):** the engine evaluates the sun at the PVGIS irradiance sample instant (HH:00 UTC + `irradiance_time_offset`) and re-centres the power series onto the hour midpoint, rather than evaluating the sun at the midpoint. Annual energy is identical; hourly timing is more accurate. Accept, or require the literal midpoint?
- **Q2 (spec §3.7):** as built, the ±3 % gate compares against PVGIS's own model on the same TMY months; the PVcalc long-term E_y is checked at ±5 %. The literal "±3 % of PVcalc" fails Durban (−4.4 %) purely because a TMY is one sample of 16 years. Accept the reworded gate, or should the engine use multi-year PVGIS hourly data instead of the TMY?
- **Q3:** the PVGIS fixtures (≈ 830 kB gzipped, five files) are committed to the repo so the gate runs offline in CI. Acceptable, or move them to Git LFS / a download step?
