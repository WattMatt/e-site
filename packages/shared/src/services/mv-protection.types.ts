// --- Network (mesh) model — used by the Z-bus + zero-sequence fault engines ---
export interface Bus {
  id: string
  name: string
  baseKv: number
  breakingCapacityKa?: number
}
export interface LineBranch {
  id: string
  kind: 'line'
  from: string
  to: string
  closed: boolean
  rPerKm: number
  xPerKm: number
  lengthKm: number
  parallel?: number
  csaMm2?: number
  r0PerKm?: number
  x0PerKm?: number
  c0nFPerKm?: number // zero-sequence (phase-to-earth) capacitance, for unearthed capacitive EF
}
export interface NeutralEarthing {
  kind: 'solid' | 'resistance' | 'reactance'
  ohms?: number
}
export interface TxBranch {
  id: string
  kind: 'transformer'
  from: string
  to: string
  closed: boolean
  ukrPct: number
  sRatedVA: number
  pkrW?: number
  vectorGroup?: string
  z0OverZ1?: number
  neutralEarthing?: NeutralEarthing
}
export type Branch = LineBranch | TxBranch
export interface Infeed {
  id: string
  bus: string
  sscVA: number
  xr: number
  z0OverZ1?: number
}
export interface MachineInfeed {
  id: string
  bus: string
  kind: 'generator' | 'motor'
  sRatedVA: number
  xr: number
  subTransientXdPct?: number // synchronous generator x″d (% on machine base)
  lockedRotorRatio?: number // induction motor I_LR / I_rM (e.g. 6)
}
export interface Inverter {
  id: string
  bus: string
  sRatedVA: number
  currentLimitFactor?: number // fault current as ×rated (grid-following inverter ~1.2)
}
export interface EarthingTransformer {
  id: string
  bus: string
  z0Ohm: number
  earthing?: NeutralEarthing
}
export interface MvNetwork {
  sBaseVA: number
  cMax: number
  cMin: number
  buses: Bus[]
  branches: Branch[]
  infeeds: Infeed[]
  machines?: MachineInfeed[]
  inverters?: Inverter[]
  earthingTransformers?: EarthingTransformer[]
  /** Assumed earth-fault resistance (Ω) for the minimum (sensitivity) Ik1 case. */
  efFaultResistanceOhm?: number
}
