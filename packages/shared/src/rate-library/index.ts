// Rate library core (E6): matcher, catalogue naming, statistics, CPI
// escalation, review grouping, priced-sheet parsing and the budget CSV.
// Pure — no I/O, no node built-ins — so it is safe from the barrel.
export * from './normalise'
export * from './match'
export * from './catalogue'
export * from './stats'
export * from './escalate'
export * from './group'
export * from './budget-csv'
export * from './parse-priced-sheets'
export * from './ingest-plan'
export * from './price-from-library'
