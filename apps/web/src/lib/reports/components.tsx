// No 'use client' — these components are rendered server-side to PDF only.
import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { spacing } from './theme'
import type { ResolvedBranding } from './branding'

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  page: {
    paddingHorizontal: spacing.pagePaddingH,
    paddingVertical: spacing.pagePaddingV,
    fontFamily: 'Helvetica',
    backgroundColor: '#FFFFFF',
  },

  // Accent rule
  accentRule: {
    height: spacing.accentRuleHeight,
    marginBottom: spacing.sectionGap,
  },

  // Issuer
  issuerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sectionGap,
  },
  issuerLogo: {
    maxHeight: spacing.issuerLogoMaxHeight,
    maxWidth: 120,
    objectFit: 'contain',
  },
  issuerWordmark: {
    fontSize: spacing.issuerWordmarkFontSize,
    fontFamily: 'Helvetica-Bold',
  },

  // Kicker + Title + Project line
  textBlock: {
    marginBottom: spacing.sectionGap,
  },
  kicker: {
    fontSize: spacing.kickerFontSize,
    letterSpacing: 2,
    color: '#888888',
    textTransform: 'uppercase',
    marginBottom: spacing.tinyGap,
  },
  title: {
    fontSize: spacing.titleFontSize,
    fontFamily: 'Helvetica-Bold',
    marginBottom: spacing.smallGap,
  },
  projectLine: {
    fontSize: spacing.projectLineFontSize,
    color: '#555555',
  },

  // Parties strip
  partiesSection: {
    marginBottom: spacing.sectionGap,
  },
  partiesLabel: {
    fontSize: spacing.partyLabelFontSize,
    letterSpacing: 1.5,
    color: '#AAAAAA',
    textTransform: 'uppercase',
    marginBottom: spacing.smallGap,
  },
  partiesRow: {
    flexDirection: 'row',
    gap: spacing.sectionGap,
  },
  partySlot: {
    alignItems: 'center',
    gap: spacing.tinyGap,
  },
  partyLogo: {
    maxHeight: spacing.partyLogoMaxHeight,
    maxWidth: 80,
    objectFit: 'contain',
  },
  partyLabel: {
    fontSize: spacing.partyLabelFontSize,
    color: '#AAAAAA',
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: spacing.pagePaddingV,
    left: spacing.pagePaddingH,
    right: spacing.pagePaddingH,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: spacing.footerFontSize,
    color: '#AAAAAA',
  },

  // Watermark
  watermarkContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    transform: 'rotate(-45deg)',
  },
  watermarkText: {
    fontSize: spacing.watermarkFontSize,
    fontFamily: 'Helvetica-Bold',
    color: '#F0F0F0',
    opacity: 0.25,
    letterSpacing: 12,
  },

  // Preview body
  bodySection: {
    marginTop: spacing.sectionGap,
    paddingTop: spacing.sectionGap,
    borderTopWidth: 0.5,
    borderTopColor: '#E0E0E0',
  },
  bodyText: {
    fontSize: spacing.loremFontSize,
    lineHeight: spacing.loremLineHeight,
    color: '#444444',
    marginBottom: spacing.smallGap,
  },
})

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

interface CoverProps {
  resolved: ResolvedBranding
}

export function Cover({ resolved }: CoverProps) {
  const { accent, issuer, parties, title, kicker, projectLine, footerStamp } =
    resolved

  return (
    <>
      {/* Accent rule */}
      <View style={[s.accentRule, { backgroundColor: accent }]} />

      {/* Issuer row */}
      <View style={s.issuerRow}>
        {issuer.logoSrc ? (
          <Image src={issuer.logoSrc} style={s.issuerLogo} />
        ) : (
          <Text style={[s.issuerWordmark, { color: accent }]}>
            {issuer.wordmark}
          </Text>
        )}
      </View>

      {/* Kicker / Title / Project line */}
      <View style={s.textBlock}>
        <Text style={s.kicker}>{kicker}</Text>
        <Text style={s.title}>{title}</Text>
        <Text style={s.projectLine}>{projectLine}</Text>
      </View>

      {/* Parties strip — only shown when at least one party has a logo */}
      {parties.length > 0 && (
        <View style={s.partiesSection}>
          <Text style={s.partiesLabel}>Prepared with</Text>
          <View style={s.partiesRow}>
            {parties.map((party) => (
              <View key={party.label} style={s.partySlot}>
                <Image src={party.logoSrc} style={s.partyLogo} />
                <Text style={s.partyLabel}>{party.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Footer stamp */}
      <View style={s.footer} fixed>
        <Text style={s.footerText}>{footerStamp}</Text>
        <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

export function Watermark() {
  return (
    <View style={s.watermarkContainer} fixed>
      <Text style={s.watermarkText}>PREVIEW</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// PreviewBody
// ---------------------------------------------------------------------------

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'

export function PreviewBody() {
  return (
    <View style={s.bodySection}>
      <Text style={s.bodyText}>{LOREM}</Text>
      <Text style={s.bodyText}>{LOREM}</Text>
      <Text style={s.bodyText}>{LOREM}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Re-export Document/Page for use in branding-preview.tsx
// ---------------------------------------------------------------------------

export { Document, Page, s as pageStyles }
