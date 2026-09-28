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
