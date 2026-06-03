// No 'use client' — these components are rendered server-side to PDF only.
import React from 'react'
import { View, Text, Image, Link, StyleSheet } from '@react-pdf/renderer'
import { spacing, passPillColors } from './theme'

// ---------------------------------------------------------------------------
// Shared types from inspection-report-data.ts (Task 4 type-switch).
// PassState is kept as a local export because interior.test.tsx imports it
// from './interior' and the type is not exported from inspection-report-data.
// Table's generic { columns, rows } interface is kept local (it is not a
// Report* type).
// ---------------------------------------------------------------------------

export type PassState = 'pass' | 'fail' | 'na' | null

// Import types for use within this file, then re-export for consumers.
// (A bare `export type { ... } from '...'` does not make the names available
// as local identifiers within the same file.)
import type {
  ReportFieldRow,
  ReportPhoto,
  ReportPhotoField,
  ReportSignature,
  ReportAnnexure,
} from './inspection-report-data'

export type {
  ReportFieldRow,
  ReportPhoto,
  ReportPhotoField,
  ReportSignature,
  ReportAnnexure,
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  // RunningHeader
  runningHeader: {
    position: 'absolute',
    top: 0,
    left: spacing.pagePaddingH,
    right: spacing.pagePaddingH,
    height: spacing.runningHeaderHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E7EB',
  },
  headerLogo: {
    maxHeight: spacing.headerLogoMaxHeight,
    maxWidth: 60,
    objectFit: 'contain',
  },
  headerTitle: {
    fontSize: spacing.headerFontSize,
    color: '#888888',
    fontFamily: 'Helvetica',
  },
  headerPageNum: {
    fontSize: spacing.headerFontSize,
    color: '#AAAAAA',
    fontFamily: 'Helvetica',
  },

  // RunningFooter
  runningFooter: {
    position: 'absolute',
    bottom: 0,
    left: spacing.pagePaddingH,
    right: spacing.pagePaddingH,
    height: spacing.runningFooterHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: '#E5E7EB',
  },
  footerStamp: {
    fontSize: spacing.headerFontSize,
    color: '#AAAAAA',
    fontFamily: 'Helvetica',
  },
  footerLogo: {
    maxHeight: spacing.runningFooterHeight - 8,
    maxWidth: 60,
    objectFit: 'contain',
  },

  // Section
  section: {
    marginBottom: spacing.sectionGap,
  },
  sectionHeading: {
    fontSize: spacing.sectionHeadingFontSize,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  sectionRule: {
    height: spacing.sectionRuleHeight,
    marginBottom: spacing.smallGap,
  },

  // ResultRow
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.rowGap,
    gap: spacing.smallGap,
  },
  rowLabel: {
    fontSize: spacing.rowLabelFontSize,
    color: '#374151',
    fontFamily: 'Helvetica',
    flex: 1,
  },
  rowValue: {
    fontSize: spacing.rowValueFontSize,
    color: '#111827',
    fontFamily: 'Helvetica',
    flex: 1,
  },
  failReason: {
    fontSize: spacing.failReasonFontSize,
    color: '#991B1B',
    fontFamily: 'Helvetica',
    marginTop: 2,
    marginLeft: 0,
  },
  subheadingText: {
    fontSize: spacing.rowLabelFontSize + 1,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginTop: spacing.rowGap,
    marginBottom: 2,
  },
  paragraphValue: {
    fontSize: spacing.rowValueFontSize,
    color: '#374151',
    fontFamily: 'Helvetica',
    lineHeight: 1.5,
  },
  valueBlock: {
    flex: 1,
  },

  // ResultPill
  pill: {
    borderRadius: 3,
    paddingHorizontal: spacing.pillPaddingH,
    paddingVertical: spacing.pillPaddingV,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: spacing.pillFontSize,
    fontFamily: 'Helvetica-Bold',
  },

  // Table
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 0.5,
    borderBottomColor: '#D1D5DB',
  },
  tableBodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E7EB',
  },
  tableHeaderCell: {
    fontSize: spacing.tableHeaderFontSize,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    padding: 4,
    flex: 1,
  },
  tableBodyCell: {
    fontSize: spacing.tableCellFontSize,
    fontFamily: 'Helvetica',
    color: '#111827',
    padding: 4,
    flex: 1,
  },

  // PhotoGrid
  photoGrid: {
    marginBottom: spacing.sectionGap,
  },
  photoGridLabel: {
    fontSize: spacing.rowLabelFontSize,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    marginBottom: spacing.smallGap,
  },
  photoGridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // NOTE: no `gap` here — gutter is cell-padding (Fix 1).
    // Yoga/react-pdf treats `width` as border-box, so padding sits INSIDE
    // the 33.33% cell width. Three cells then sum to exactly 100% and hold
    // exactly spacing.photoGridCols columns without wrapping to 2-up.
  },
  photoCell: {
    width: `${100 / spacing.photoGridCols}%`,
    // Gutter lives here (inside the border-box width) rather than on the
    // container, so three cells sum to exactly 100% and the grid stays 3-up.
    paddingRight: spacing.photoCellGap,
    paddingBottom: spacing.photoCellGap,
  },
  photoCellImage: {
    width: '100%',
    objectFit: 'contain',
  },
  photoCellPlaceholder: {
    backgroundColor: '#F3F4F6',
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCellPlaceholderText: {
    fontSize: spacing.photoCaptionFontSize,
    color: '#9CA3AF',
    fontFamily: 'Helvetica',
  },
  photoCaptionText: {
    fontSize: spacing.photoCaptionFontSize,
    color: '#6B7280',
    fontFamily: 'Helvetica',
    marginTop: 2,
  },
  photoOmittedNote: {
    fontSize: spacing.photoCaptionFontSize,
    color: '#9CA3AF',
    fontFamily: 'Helvetica',
    marginTop: spacing.tinyGap,
  },

  // SignatureBlock
  signatureBlock: {
    borderWidth: 0.5,
    borderColor: '#D1D5DB',
    padding: spacing.smallGap,
    marginBottom: spacing.sectionGap,
  },
  signatureRole: {
    fontSize: spacing.rowLabelFontSize,
    color: '#6B7280',
    fontFamily: 'Helvetica',
    marginBottom: 2,
  },
  signatureName: {
    fontSize: spacing.rowValueFontSize,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  signatureTitle: {
    fontSize: spacing.rowLabelFontSize,
    color: '#374151',
    fontFamily: 'Helvetica',
  },
  signatureReg: {
    fontSize: spacing.rowLabelFontSize,
    color: '#374151',
    fontFamily: 'Helvetica',
  },
  signatureDate: {
    fontSize: spacing.rowLabelFontSize,
    color: '#6B7280',
    fontFamily: 'Helvetica',
    marginTop: 2,
  },
  signatureImage: {
    maxHeight: spacing.signatureImageMaxHeight,
    maxWidth: 120,
    objectFit: 'contain',
    marginTop: spacing.smallGap,
  },

  // AnnexureList
  annexureList: {
    marginBottom: spacing.sectionGap,
  },
  annexureEmpty: {
    fontSize: spacing.annexureRowFontSize,
    color: '#9CA3AF',
    fontFamily: 'Helvetica',
  },
  annexureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.tinyGap,
    gap: spacing.smallGap,
  },
  annexureLabel: {
    fontSize: spacing.annexureRowFontSize,
    color: '#6B7280',
    fontFamily: 'Helvetica',
    minWidth: 60,
  },
  annexureName: {
    fontSize: spacing.annexureRowFontSize,
    color: '#111827',
    fontFamily: 'Helvetica',
    flex: 1,
  },
  annexureNameLink: {
    fontSize: spacing.annexureRowFontSize,
    color: '#2563EB',
    fontFamily: 'Helvetica',
    flex: 1,
    textDecoration: 'underline',
  },
  annexureMeta: {
    fontSize: spacing.annexureRowFontSize - 1,
    color: '#9CA3AF',
    fontFamily: 'Helvetica',
    marginTop: 1,
  },
  annexureThumbnail: {
    maxHeight: 24,
    maxWidth: 24,
    objectFit: 'contain',
    marginRight: 4,
  },
})

// ---------------------------------------------------------------------------
// RunningHeader
// Renders at the top of every interior page (fixed). Shows the issuer logo
// (when available) or issuer title text, plus a page-number counter.
// Accent is used for branding if needed by subclasses — passed as prop.
// ---------------------------------------------------------------------------

interface RunningHeaderProps {
  issuerLogoDataUri: string | null
  title: string
  accent: string
}

export function RunningHeader({ issuerLogoDataUri, title, accent }: RunningHeaderProps) {
  return (
    <View style={s.runningHeader} fixed>
      {/* Left: issuer identity */}
      {issuerLogoDataUri ? (
        <Image src={issuerLogoDataUri} style={s.headerLogo} />
      ) : (
        <Text style={[s.headerTitle, { color: accent }]}>{title}</Text>
      )}
      {/* Right: page number — render prop mirrors Cover footer */}
      <Text
        style={s.headerPageNum}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// RunningFooter
// Renders at the bottom of every interior page (fixed). Shows a stamp string
// and optionally the contractor logo.
// ---------------------------------------------------------------------------

interface RunningFooterProps {
  contractorLogoDataUri: string | null
  stamp: string
  accent: string
}

export function RunningFooter({ contractorLogoDataUri, stamp, accent }: RunningFooterProps) {
  return (
    <View style={s.runningFooter} fixed>
      {/* Brand hairline — thin accent rule above the stamp/logo row */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: accent }} />
      <Text style={s.footerStamp}>{stamp}</Text>
      {contractorLogoDataUri && (
        <Image src={contractorLogoDataUri} style={s.footerLogo} />
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Section
// A titled section with an accent rule. Marked wrap so react-pdf keeps
// the heading with its content when page-breaking.
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string
  accent: string
  children: React.ReactNode
}

export function Section({ title, accent, children }: SectionProps) {
  return (
    <View style={s.section} wrap>
      {/* Accent rule */}
      <View style={[s.sectionRule, { backgroundColor: accent, height: spacing.sectionRuleHeight }]} />
      <Text style={s.sectionHeading}>{title}</Text>
      {children}
    </View>
  )
}

// ---------------------------------------------------------------------------
// ResultPill
// Semantic pass/fail/na/null badge. Colour from passPillColors — no accent.
// ---------------------------------------------------------------------------

interface ResultPillProps {
  pass: PassState
}

export function ResultPill({ pass }: ResultPillProps) {
  const { bg, fg } = passPillColors(pass)
  const label = pass === 'pass' ? 'PASS' : pass === 'fail' ? 'FAIL' : pass === 'na' ? 'N/A' : '—'
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text style={[s.pillText, { color: fg }]}>{label}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// ResultRow
// Data row driven off ReportFieldRow.kind. Accent only threaded into kinds
// that actually consume it — none currently do, so no accent prop.
// ---------------------------------------------------------------------------

interface ResultRowProps {
  row: ReportFieldRow
}

export function ResultRow({ row }: ResultRowProps) {
  if (row.kind === 'subheading') {
    return (
      <View style={s.resultRow}>
        <Text style={s.subheadingText}>{row.label}</Text>
      </View>
    )
  }

  if (row.kind === 'result') {
    return (
      <View style={s.resultRow}>
        <Text style={s.rowLabel}>{row.label}</Text>
        <ResultPill pass={row.pass ?? null} />
        {row.failReason && (
          <Text style={s.failReason}>{row.failReason}</Text>
        )}
      </View>
    )
  }

  if (row.kind === 'paragraph') {
    return (
      <View style={s.resultRow}>
        <Text style={s.rowLabel}>{row.label}</Text>
        <View style={s.valueBlock}>
          <Text style={s.paragraphValue}>{row.value ?? ''}</Text>
        </View>
      </View>
    )
  }

  // kind === 'value' | 'list'
  // 'list' renders identically to 'value': the data-gatherer (Task 3) pre-joins
  // multi_select values into a single comma-joined string stored in row.value,
  // so no special list rendering is needed here.
  return (
    <View style={s.resultRow}>
      <Text style={s.rowLabel}>{row.label}</Text>
      <Text style={s.rowValue}>{row.value ?? ''}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Table
// Generic table — used for Audit appendix and similar tabular data.
// ---------------------------------------------------------------------------

interface TableProps {
  columns: string[]
  rows: string[][]
}

export function Table({ columns, rows }: TableProps) {
  return (
    <View>
      {/* Header */}
      <View style={s.tableHeaderRow}>
        {columns.map((col, i) => (
          <Text key={i} style={s.tableHeaderCell}>{col}</Text>
        ))}
      </View>
      {/* Body */}
      {rows.map((row, ri) => (
        <View key={ri} style={s.tableBodyRow}>
          {row.map((cell, ci) => (
            <Text key={ci} style={s.tableBodyCell}>{cell}</Text>
          ))}
        </View>
      ))}
    </View>
  )
}

// ---------------------------------------------------------------------------
// PhotoGrid
// N-up photo grid keyed to a ReportPhotoField. accent used for the label.
// ---------------------------------------------------------------------------

interface PhotoGridProps {
  field: ReportPhotoField
  accent: string
}

export function PhotoGrid({ field, accent }: PhotoGridProps) {
  return (
    <View style={s.photoGrid}>
      <Text style={[s.photoGridLabel, { color: accent }]}>{field.label}</Text>
      <View style={s.photoGridRow}>
        {field.photos.map((photo, i) => (
          <View key={i} style={s.photoCell}>
            {photo.dataUri ? (
              <Image src={photo.dataUri} style={s.photoCellImage} />
            ) : (
              <View style={s.photoCellPlaceholder}>
                <Text style={s.photoCellPlaceholderText}>[image unavailable]</Text>
              </View>
            )}
            <Text style={s.photoCaptionText}>{photo.caption}</Text>
          </View>
        ))}
      </View>
      {field.omittedCount > 0 && (
        <Text style={s.photoOmittedNote}>{`+${field.omittedCount} omitted`}</Text>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// SignatureBlock
// Displays a signatory's credentials + an optional signature image.
// ---------------------------------------------------------------------------

interface SignatureBlockProps {
  signature: ReportSignature
}

export function SignatureBlock({ signature }: SignatureBlockProps) {
  const { role, name, title, registrationNumber, signedAt, imageDataUri } = signature
  return (
    <View style={s.signatureBlock}>
      <Text style={s.signatureRole}>{role}</Text>
      <Text style={s.signatureName}>{name}</Text>
      {title && <Text style={s.signatureTitle}>{title}</Text>}
      {registrationNumber && (
        <Text style={s.signatureReg}>Reg # {registrationNumber}</Text>
      )}
      {signedAt && <Text style={s.signatureDate}>{signedAt}</Text>}
      {imageDataUri && (
        <Image src={imageDataUri} style={s.signatureImage} />
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// AnnexureList
// One row per annexure; image annexures show a thumbnail, linked ones a Link.
// ---------------------------------------------------------------------------

interface AnnexureListProps {
  annexures: ReportAnnexure[]
}

const SOURCE_LABEL: Record<ReportAnnexure['source'], string> = {
  attachment: 'Attachment',
  handover: 'Handover',
}

export function AnnexureList({ annexures }: AnnexureListProps) {
  if (annexures.length === 0) {
    return (
      <View style={s.annexureList}>
        <Text style={s.annexureEmpty}>No annexures.</Text>
      </View>
    )
  }

  return (
    <View style={s.annexureList}>
      {annexures.map((ann, i) => (
        <View key={i} style={s.annexureRow}>
          {ann.thumbnailDataUri && (
            <Image src={ann.thumbnailDataUri} style={s.annexureThumbnail} />
          )}
          <Text style={s.annexureLabel}>{SOURCE_LABEL[ann.source]}</Text>
          <View style={s.valueBlock}>
            {ann.href ? (
              <Link src={ann.href} style={s.annexureNameLink}>{ann.name}</Link>
            ) : (
              <Text style={s.annexureName}>{ann.name}</Text>
            )}
            {ann.meta && <Text style={s.annexureMeta}>{ann.meta}</Text>}
          </View>
        </View>
      ))}
    </View>
  )
}
