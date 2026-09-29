import type { ReviewModel } from '@/lib/solar/meter-import/review'

export function review(over: Partial<ReviewModel> = {}): ReviewModel {
  return {
    fileId: 'f1', fileName: 'SITE YA, SHOP 012, PEP, 120.csv', sheetName: null, reportId: 'r1', outcome: 'series', format: 'A',
    report: { format: 'A', formatLabel: 'A', periodStart: '2025-01-01T00:30:00Z', periodEnd: '2025-12-31T23:30:00Z', rowOrder: 'ascending', tsConvention: 'begin', dateOrder: 'DMY', dateOrderAmbiguous: false, intervalMin: 30, dailyInterval: false, duplicates: 0, twentyFourHundredRows: 0, calcShare: null, impliedWPerM2: null, errors: [], warnings: [], channels: [] } as never,
    hints: { site: 'SITE YA', shopNo: '012', label: 'PEP', areaM2: 120, serial: null, register: [] },
    channels: [{ column: 'p14', quantity: 'active_power', direction: 'import', phase: null, sourceUnit: 'kW', storedUnit: 'kW', unitFromTable: true, suggestedUnit: null, intervalMin: 30, coverageOnly: false, isCumulative: false, isPrimaryDefault: true, completeness: 0.99, meanStored: 4, maxStored: 9, levelShiftSegments: 0 }],
    preview: [], identity: { sourceSerials: [], filenameSerial: null, conflicts: [], blocking: false }, registerRows: 0,
    choicesNeeded: [], blockingErrors: [], canAccept: true, ...over,
  }
}
