import { describe, expect, it } from 'vitest'
import { normaliseText, normaliseUnit } from './normalise'
import { matchLine } from './match'

const m = (sectionPath: string[], description: string, unit: string | null, extra: Partial<Parameters<typeof matchLine>[0]> = {}) =>
  matchLine({ sectionPath, description, unit, supplyRate: 10, installRate: 5, ...extra })

describe('normaliseText', () => {
  it('turns decimal commas, squares and diameter marks into one spelling', () => {
    expect(normaliseText('2,5mm²')).toBe('2.5mm2')
    expect(normaliseText('20mm Ø')).toBe('20mm dia')
    expect(normaliseText('150 ø NEXTUBE')).toBe('150 dia nextube')
    expect(normaliseText('  Flush   1 way ,  1 lever ')).toBe('flush 1 way, 1 lever')
  })
  it('keeps thousands commas intact when they are not decimals', () => {
    expect(normaliseText('Supply 11,000 Volt')).toBe('supply 11000 volt')
  })
})

describe('normaliseUnit', () => {
  it.each([
    ['No', 'no'], ['each', 'no'], ['EA', 'no'], ['Item', 'no'], ['m', 'm'], ['lm', 'm'],
    ['m³', 'm3'], ['m3', 'm3'], ['HR', 'hr'], ['months', 'month'], ['Sum', 'sum'], ['Lot', 'lot'],
    ['%', 'pct'], [null, null], ['', null],
  ])('%s -> %s', (raw, want) => expect(normaliseUnit(raw)).toBe(want))
})

describe('matchLine — exclusions (never a rate)', () => {
  it('excludes prime-cost and provisional sums', () => {
    expect(m(['SUPPLY OF LIGHT FITTINGS'], 'Prime Cost amount for the supply of light fittings', 'Sum', { quantityMode: 'pc_sum' }))
      .toEqual({ kind: 'excluded', reason: 'pc_or_provisional' })
    expect(m(['MATERIAL'], 'Provisional Sum', 'Sum', { quantityMode: 'provisional' }))
      .toEqual({ kind: 'excluded', reason: 'pc_or_provisional' })
  })
  it('excludes profit percentages and contingencies', () => {
    expect(m(['AS BUILT DRAWINGS'], 'add profit to item F4.1', '%').kind).toBe('excluded')
    expect(m(['CONTINGENCY'], 'Bills 2 - 3', '0.05').kind).toBe('excluded')
  })
  it('excludes unpriced lines and lump sums', () => {
    expect(m(['CONDUIT'], '20mm Ø', 'm', { supplyRate: 0, installRate: 0 })).toEqual({ kind: 'excluded', reason: 'unpriced' })
    expect(m(['PRELIMINARY AND GENERAL'], 'Name board', 'sum', { supplyRate: null, installRate: null, rate: 1500 }))
      .toEqual({ kind: 'excluded', reason: 'lump_sum' })
  })
})

describe('matchLine — deterministic rules', () => {
  it('reads a terse description through its section heading (conduit)', () => {
    const r = m(['ASJ', 'CONDUIT'], '20mm Ø', 'm')
    expect(r.kind).toBe('match')
    if (r.kind !== 'match') return
    expect(r.signature).toBe('conduit|m|dia=20|material=pvc')
    expect(r.assumed).toEqual(['material'])
    expect(r.confidence).toBe('high')
  })
  it('keeps galvanised conduit apart from PVC', () => {
    const r = m(['CONDUITS'], '25mm Ø galvanized', 'm')
    expect(r.kind === 'match' && r.signature).toBe('conduit|m|dia=25|material=steel')
  })
  it('LV cable: cores, size, installation from the heading, copper unless stated', () => {
    // A heading naming several methods is one all-purpose rate: the attribute
    // is exactly the set of methods named, so it never merges with a
    // ground-only or tray-only rate.
    const r = m(['LV CABLE LAID IN GROUND, DRAWN THROUGH SLEEVES OR ON CABLE TRAY'], '4C x 95mm', 'm')
    expect(r.kind === 'match' && r.signature).toBe('lv_cable|m|conductor=cu|cores=4|install=ground+sleeve+tray|size=95')
    const t = m(['LV CABLE DRAWN ON CABLE TRAY OR IN TRUNKING'], '4C x 35mm', 'm')
    expect(t.kind === 'match' && t.signature).toBe('lv_cable|m|conductor=cu|cores=4|install=tray+trunking|size=35')
    expect(m(['(UNCATEGORISED)'], '4C x 240mm', 'm').kind).toBe('partial')
    const g = m(['LV CABLES LAID IN GROUND'], '4 Core x 6mm', 'm')
    expect(g.kind === 'match' && g.signature).toBe('lv_cable|m|conductor=cu|cores=4|install=ground|size=6')
    const al = m(['LV CABLE ON CABLE LADDER'], '4C x 95mm2 Al', 'm')
    expect(al.kind === 'match' && al.signature).toBe('lv_cable|m|conductor=al|cores=4|install=ladder|size=95')
  })
  it('cable terminations are their own item, per unit', () => {
    const r = m(['CABLE TERMINATIONS'], '4C x 185mm2', 'No')
    expect(r.kind === 'match' && r.signature).toBe('cable_termination|no|conductor=cu|cores=4|size=185')
  })
  it('trunking: profile and component, unit kept in the signature', () => {
    const a = m(['WIRING TRUNKING'], 'P9000 Straight lengths', 'No')
    const b = m(['WIRING TRUNKING'], 'P9000 Straight lengths', 'm')
    expect(a.kind === 'match' && a.signature).toBe('trunking|no|component=straight|profile=p9000')
    expect(b.kind === 'match' && b.signature).toBe('trunking|m|component=straight|profile=p9000')
  })
  it('cable tray width and component', () => {
    const r = m(['CABLE TRAY'], '300 wide horizontal bends', 'No')
    expect(r.kind === 'match' && r.signature).toBe('cable_tray|no|component=horizontal_bend|type=tray|width=300')
    const w = m(['WIRE BASKET'], '200 Wide T - Pieces', 'No')
    expect(w.kind === 'match' && w.signature).toBe('cable_tray|no|component=t_piece|type=wire_basket|width=200')
  })
  it('socket outlets: rating, pins, gang, switching', () => {
    const r = m(['APPLIANCES'], 'Double 16A, 3 pin switched socket outlet in 100 x 100 box', 'No')
    expect(r.kind === 'match' && r.signature).toBe('socket_outlet|no|gang=double|pins=3|rating=16|switching=switched')
    const u = m(['APPLIANCES'], '5A, 3 pin unswitched socket outlet in 100 x 50 box (box elsewhere measured)', 'No')
    expect(u.kind === 'match' && u.signature).toBe('socket_outlet|no|gang=single|pins=3|rating=5|switching=unswitched')
  })
  it('isolators need both rating and poles', () => {
    expect(m(['ISOLATORS'], '60A TP', 'No')).toMatchObject({ kind: 'match', signature: 'isolator|no|poles=tp|rating=60' })
    expect(m(['ISOLATORS'], 'Isolator', 'No').kind).toBe('partial')
  })
  it('labour: trade and time', () => {
    expect(m(['LABOUR'], 'Electrician:- Over Time', 'HR', { supplyRate: null, installRate: 450 }))
      .toMatchObject({ kind: 'match', signature: 'labour|hr|time=overtime|trade=electrician' })
  })
  it('trenching: width and depth from the heading, ground from the line', () => {
    const r = m(['TRENCHING (600 WIDE X 1000 DEEP)'], 'Soft pickable ground', 'm³')
    expect(r.kind === 'match' && r.signature).toBe('trenching|m3|depth=1000|ground=soft_pickable|width=600')
  })
  it('single-core conductors and earth conductors stay apart', () => {
    expect(m(['CONDUCTOR'], '2,5mm2', 'm')).toMatchObject({ signature: 'conductor|m|size=2.5' })
    expect(m(['EARTH CONDUCTOR'], '2,5mm2', 'm')).toMatchObject({ signature: 'earth_conductor|m|size=2.5' })
    expect(m(['CONDUCTOR'], 'SURFIX 4C x 4mm2', 'm')).toMatchObject({ signature: 'multicore_wiring|m|cores=4|size=4' })
  })
  it('MV cable from an MVL parent heading', () => {
    const r = m(['BILL NO 2', 'MV Cable 300mm² x 3 AL 11KV XLPE'], 'MV Cable 300mm² x 3 AL 11KV XLPE', 'm')
    expect(r.kind === 'match' && r.signature).toBe('mv_cable|m|conductor=al|cores=3|kv=11|size=300')
  })
  it('a rate given for supply only or install only is a different item', () => {
    const r = m(['LOW VOLTAGE DISTRIBUTION BOARDS'], '84 Way (200A TP)', 'Lot', { supplyRate: null, installRate: 1800 })
    expect(r.kind === 'match' && r.signature).toBe('distribution_board|no|scope=install_only|ways=84')
  })
  it('does not force neighbours of a heading into its category', () => {
    expect(m(['LIGHT SWITCHES'], 'Door bel', 'No').kind).toBe('none')
    expect(m(['LIGHT SWITCHES'], 'Occupancy sensor', 'No').kind).toBe('none')
    expect(m(['LIGHT SWITCHES'], '10A, 240V three position key switch (off, step 1, step 2)', 'No').kind).toBe('none')
    expect(m(['HEAT PUMP CONNECTION'], 'Supply and install isolator, flexible connection, wiring and', 'No').kind).toBe('none')
    expect(m(['CONDUIT BOXES'], '100 x 100 blank cover', 'No').kind).toBe('none')
    expect(m(['11kV BMK (Metering type RMU)'], 'Isolation test of switching', 'Item').kind).toBe('none')
  })
  it('MVL trench lines read their width and depth from an introducing heading', () => {
    expect(m(['B', 'Excavate for Linear Meter', 'Excavate and Backfill 600mm Wide & 1400mm deep with 200mm Soft Soil Bedding'], 'Pickable Soil', 'm'))
      .toMatchObject({ signature: 'trenching|m|depth=1400|ground=pickable|width=600' })
  })
  it('handles the spellings and shorthands seen in real bills', () => {
    expect(m(['LABOUR'], 'Laborer:- Sunday', 'HR')).toMatchObject({ signature: 'labour|hr|time=sunday|trade=labourer' })
    expect(m(['WIRING TRUNKING'], 'P8000 Off - Sets', 'No')).toMatchObject({ signature: 'trunking|no|component=offset|profile=p8000' })
    expect(m(['PVC SLEEVES'], '110mm Ø', 'm')).toMatchObject({ signature: 'cable_sleeve|m|dia=110|material=pvc' })
    expect(m(['CABLE TRAY'], '600 wide cover', 'No')).toMatchObject({ signature: 'cable_tray|no|component=cover|type=tray|width=600' })
  })
  it('reads P2000 as one profile and "P2 200" as another', () => {
    expect(m(['WIRING TRUNKING'], 'P2000 Bends', 'No')).toMatchObject({ signature: 'trunking|no|component=bend|profile=p2000' })
    expect(m(['TRUNKING CHASED INTO CONCRETE FLOOR'], 'P2 200 Vertical bends', 'No')).toMatchObject({ signature: 'trunking|no|component=vertical_bend|profile=p2-200' })
  })
  it('NEXTUBE is a sleeve even under an earth-terminations heading', () => {
    expect(m(['EARTH TERMINATIONS'], '110mm Ø NEXTUBE supply and install', 'm')).toMatchObject({ signature: 'cable_sleeve|m|dia=110|material=nextube' })
    expect(m(['EARTH TERMINATIONS'], '70mm', 'No')).toMatchObject({ signature: 'earth_termination|no|size=70' })
  })
  it('a combination socket is a product, not a double socket', () => {
    expect(m(['APPLIANCES'], 'Double 16 A, Combo socket 164-2(Dedicated)', 'No').kind).toBe('none')
  })
  it('a bare tray width priced per metre is a straight run, and says so', () => {
    const r = m(['CABLE TRAY'], '300 wide', 'm')
    expect(r).toMatchObject({ kind: 'match', signature: 'cable_tray|m|component=straight|type=tray|width=300', assumed: ['component'] })
    expect(m(['CABLE TRAY'], '300 wide', 'No').kind).toBe('partial')
  })
  it('a rule with nothing to check never auto-confirms', () => {
    expect(m(['POWER POLES'], 'Power pole', 'No').kind).toBe('partial')
    expect(m(['PHOTOCELL'], 'Supply, install and connect photocell switch', 'No').kind).toBe('partial')
    expect(m(['POWERPOLE'], '3.4m Power pole', 'No')).toMatchObject({ kind: 'match', signature: 'power_pole|no|height=3.4' })
  })
  it('reads the conductor from the whole section path, not only the last heading', () => {
    expect(m(['LV CABLES - ALUMINIUM', 'LAID IN GROUND'], '4C x 95mm cable', 'm'))
      .toMatchObject({ signature: 'lv_cable|m|conductor=al|cores=4|install=ground|size=95', assumed: [] })
  })
  it('lists every defaulted socket attribute as assumed', () => {
    const r = m(['POWERSKIRTING'], '16A Normal socket outlet', 'No')
    expect(r).toMatchObject({ kind: 'match' })
    expect(r.kind === 'match' && [...r.assumed].sort()).toEqual(['gang', 'pins', 'switching'])
    const e = m(['APPLIANCES'], 'Double 16A, 3 pin unswitched socket outlet', 'No')
    expect(e.kind === 'match' && e.assumed).toEqual([])
  })
  it('unknown products are left unmatched, not guessed', () => {
    expect(m(['LIGHT FITTINGS'], 'Type HL1-MC428 Linear Hi Bay-120 W Led-4000K', 'No').kind).toBe('none')
  })
})
