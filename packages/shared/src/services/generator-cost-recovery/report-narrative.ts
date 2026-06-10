/**
 * Default narrative for the generator cost-recovery report.
 *
 * These are the standing prose sections that precede the calculated tables in a
 * standby-system cost-recovery report (Introduction, Plant Sizing rationale,
 * Outline of System, Switching System). They are deliberately generic so any
 * consulting firm can use them as-is or override per project.
 *
 * Storage/editing (gcr.settings narrative columns + the Report tab) is layered
 * on later; until a project saves its own text the report falls back to these.
 *
 * Paragraphs are separated by a blank line ("\n\n"); the report renderer splits
 * on that boundary.
 */

export interface ReportNarrative {
  introduction: string
  plantSizing: string
  systemOutline: string
  switching: string
}

export const DEFAULT_REPORT_NARRATIVE: ReportNarrative = {
  introduction:
    'This document supports the operation and maintenance of the standby power system for the centre. ' +
    'Standby supply to each shop is intentionally limited to small power and lighting; mechanical heating ' +
    'and cooling are excluded, other than fresh-air supplies. Limiting the supply in this way prevents ' +
    'oversizing of the plant, reduces operating and running costs, and lowers each tenant’s cost of occupation.',

  plantSizing:
    'Plant sizing is based on an allowance of 30 VA/m² of gross lettable area. Exceptions apply where a ' +
    'tenant has requested a larger supply, or where a food outlet requires additional capacity to trade ' +
    'functionally. Tenants providing their own standby solution are excluded from the shared plant.',

  systemOutline:
    'A standby system has been designed to provide a predetermined load to all line shops not providing ' +
    'their own. To minimise the tenants’ cost of occupation and reduce the running and maintenance cost ' +
    'of the system, the design provides:\n\n' +
    'Selective metering able to separately meter and account for all standby kWh consumed. ' +
    'A switching system that identifies the condition under which power is being supplied and, on a power ' +
    'failure, disconnects pre-selected non-essential circuits and restores them when normal supply returns. ' +
    'Operational functionality that allows trained staff to switch each tenant’s standby supply on or off ' +
    'in line with the lease, without wiring changes unless the tenant’s requirements change.',

  switching:
    'To facilitate the reduced standby load, each shop’s distribution board is split between essential and ' +
    'non-essential supply. Under standby conditions the non-essential section is dropped and disconnected ' +
    'from the supply, and is restored when normal operating conditions return.',
}
