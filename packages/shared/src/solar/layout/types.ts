/**
 * Solar Layout — shared shapes (functional spec §6, data model §3).
 *
 * Stored geometry is IMAGE PIXELS of the sheet: the fixed scale-2 raster that
 * apps/web/src/lib/sheet/use-sheet-image.ts defines (a PDF page at
 * getViewport({ scale: 2 }), a raster at its natural size). Metres come from
 * each object's own `pixelsPerMeter`, which the DATABASE stamps when the object
 * is first saved (00211 layout_objects_bind) — never from the browser.
 *
 * Plan metres (what the geometry modules compute in) are image pixels divided
 * by that scale: x to the right, y DOWN the sheet.
 */
export interface Pt {
  x: number
  y: number
}

/** Mirrors the CHECK on solar.layout_objects.kind (00211). 'north' is reserved: the north reference lives on the roof source. */
export const LAYOUT_OBJECT_KINDS = [
  'roof', 'obstruction', 'array', 'module_block', 'inverter', 'string', 'equipment', 'north',
] as const
export type LayoutObjectKind = (typeof LAYOUT_OBJECT_KINDS)[number]

export const ROOF_TYPES = ['flat', 'pitched', 'carport', 'ground'] as const
export type RoofType = (typeof ROOF_TYPES)[number]

export type ModuleOrientation = 'portrait' | 'landscape'
export type MountingKind = 'flush' | 'racked'

export const EQUIPMENT_KINDS = ['battery', 'db', 'combiner'] as const
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

/** A PV module as the layout needs it: size, power and the §3.3 string-sizing figures. */
export interface LayoutModuleSpec {
  make: string
  model: string
  /** Long side, metres. */
  lengthM: number
  /** Short side, metres. */
  widthM: number
  /** STC rating, watts. */
  powerW: number
  vocStc: number
  vmpStc: number
  iscStc: number
  /** Voc temperature coefficient, fraction per °C (negative). */
  betaVocPerC: number
  /** Vmp temperature coefficient, fraction per °C (negative). */
  gammaVmpPerC: number
}

/** An inverter as the layout needs it (functional spec §6.3 "Inverter"). Every MPPT has the same limits. */
export interface LayoutInverterSpec {
  make: string
  model: string
  acKw: number
  mppts: number
  vDcMax: number
  vMpptMin: number
  vMpptMax: number
  /** Maximum input current per MPPT, amps. */
  iMpptMax: number
}

export interface RoofProps {
  name: string
  roofType: RoofType
  /** Degrees from horizontal; 0 for flat, carport and ground unless stated. */
  pitchDeg: number
  /** Sheet bearing (° clockwise from sheet-up) of the DOWNHILL direction; null until drawn. */
  fallBearingDeg: number | null
  heightM: number
  setbackM: number
  /** Note only (functional spec §6.3). */
  maxLoadKgM2: number | null
}

export interface ObstructionProps {
  name: string
  setbackM: number
  heightM: number
}

export interface ArrayProps {
  /** The roof object this array was placed on. */
  roofId: string
  module: LayoutModuleSpec
  orientation: ModuleOrientation
  mounting: MountingKind
  /** Module tilt from horizontal. Flush = the roof pitch; racked = the rack tilt. */
  tiltDeg: number
  /** Sheet bearing the modules FACE (flush: the roof's fall line; racked: the row normal). */
  facingSheetDeg: number
  /** A true azimuth the user typed over the derived one (functional spec §6.4). */
  azimuthOverrideDeg: number | null
  /** Centre-to-centre spacing of rows along the facing direction, metres on plan. */
  rowPitchM: number
  /** Gap between modules, metres (default 0.02). */
  gapM: number
}

export interface InverterProps {
  name: string
  inverter: LayoutInverterSpec
}

/** A module inside an array or module block, by position in that object's `modules` list. */
export interface ModuleRef {
  arrayId: string
  index: number
}

export interface StringProps {
  inverterId: string
  /** 1-based MPPT input on that inverter. */
  mppt: number
  /** In series order. */
  modules: ModuleRef[]
}

export interface EquipmentProps {
  equipmentKind: EquipmentKind
  name: string
  /** structure.nodes id — REQUIRED for a DB symbol (00211 refuses a free-floating DB). */
  nodeId: string | null
}

export interface PolygonGeometry { points: number[] }
export interface CircleGeometry { cx: number; cy: number; r: number }
/** Each module is one quad: [x1,y1,x2,y2,x3,y3,x4,y4] in image pixels. */
export interface ModulesGeometry { modules: number[][] }
export interface PointGeometry { x: number; y: number }

interface ObjectBase {
  id: string
  /** The scale stamped by the database on first save; null only before the first save. */
  pixelsPerMeter: number | null
}
export type RoofObject = ObjectBase & { kind: 'roof'; geometry: PolygonGeometry; props: RoofProps }
export type ObstructionObject = ObjectBase & { kind: 'obstruction'; geometry: PolygonGeometry | CircleGeometry; props: ObstructionProps }
export type ArrayObject = ObjectBase & { kind: 'array' | 'module_block'; geometry: ModulesGeometry; props: ArrayProps }
export type InverterObject = ObjectBase & { kind: 'inverter'; geometry: PointGeometry; props: InverterProps }
export type StringObject = ObjectBase & { kind: 'string'; geometry: Record<string, never>; props: StringProps }
export type EquipmentObject = ObjectBase & { kind: 'equipment'; geometry: PointGeometry; props: EquipmentProps }

export type LayoutObject = RoofObject | ObstructionObject | ArrayObject | InverterObject | StringObject | EquipmentObject

export function isCircleGeometry(g: PolygonGeometry | CircleGeometry): g is CircleGeometry {
  return typeof (g as CircleGeometry).r === 'number'
}

export function isArrayObject(o: LayoutObject): o is ArrayObject {
  return o.kind === 'array' || o.kind === 'module_block'
}

/**
 * A generic 550 W mono module so a layout can start before the equipment
 * catalogue exists (it arrives with the Financials phase). The user edits these
 * figures to the datasheet in the New layout dialog; they are snapshotted on the
 * layout, so a later catalogue never changes a saved design.
 */
export const GENERIC_MODULE_550: LayoutModuleSpec = {
  make: 'Generic',
  model: '550 W mono (edit to the datasheet)',
  lengthM: 2.278,
  widthM: 1.134,
  powerW: 550,
  vocStc: 49.9,
  vmpStc: 41.96,
  iscStc: 13.95,
  betaVocPerC: -0.0027,
  gammaVmpPerC: -0.0035,
}

export const GENERIC_INVERTER_50KW: LayoutInverterSpec = {
  make: 'Generic',
  model: '50 kW three-phase (edit to the datasheet)',
  acKw: 50,
  mppts: 4,
  vDcMax: 1100,
  vMpptMin: 200,
  vMpptMax: 1000,
  iMpptMax: 40,
}

/**
 * Design temperatures for string checks until the weather year exists
 * (engine spec §3.3: T_min default −5 °C inland; max ambient 35 °C). Stored per
 * layout (solar.layouts.design_t_min_c / design_t_amb_max_c) and editable.
 */
export const LAYOUT_DEFAULT_DESIGN_TEMPS = { tMinC: -5, tAmbMaxC: 35 } as const

/** Default gap between modules, metres (engine spec §3.1: 20 mm). */
export const DEFAULT_MODULE_GAP_M = 0.02
