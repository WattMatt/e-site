import type { SolarActivityTarget } from '@esite/shared'

export interface SolarActivityItem {
  id: number
  at: string
  actorName: string
  text: string
  target: SolarActivityTarget
}
