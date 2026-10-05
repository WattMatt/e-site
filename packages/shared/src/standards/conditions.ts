import type { ConditionSpec } from './extract-table'

/** Printed conditions shared by several tables; the value is always read from the page. */
export const COND = {
  ambient30: { key: 'ambient_c', label: 'Ambient temperature', unit: '°C', match: /Ambient temperature:\s*([\d,]+)\s*°C/ },
  operating70: { key: 'conductor_operating_c', label: 'Conductor operating temperature', unit: '°C', match: /Conductor operating temperature:\s*([\d,]+(?:\s*°C\s*or\s*[\d,]+)?)\s*°C/ },
  maxConductor70: { key: 'conductor_max_c', label: 'Maximum conductor temperature', unit: '°C', match: /Maximum conductor temperature:\s*([\d,]+)\s*°C/ },
  soil25: { key: 'soil_c', label: 'Soil temperature', unit: '°C', match: /Soil temperature:\s*([\d,]+)\s*°C/ },
  burialDepth: { key: 'burial_depth_m', label: 'Depth of burial', unit: 'm', match: /Depth of burial\s+([\d,]+)\s*m\b/ },
  soilResistivity: { key: 'soil_resistivity_kmw', label: 'Thermal resistivity of soil', unit: 'K·m/W', match: /Thermal resistivity of soil\s+([\d,]+)\s*K/ },
} satisfies Record<string, ConditionSpec>
