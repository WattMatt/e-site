import 'server-only'
/**
 * Optional AI narrative (decision D-17, as changed by the owner): server-side only, key read from
 * ANTHROPIC_API_KEY in the server environment (never typed by a user, never sent to the browser),
 * only the proposal's frozen figures plus the project and client names are sent, and the result is
 * returned as editable text that the caller saves into the draft.
 *
 * Model: SOLAR_NARRATIVE_MODEL, else claude-opus-5-5. Deliberately NO server-side refusal fallback
 * (no `fallbacks`, no fallback beta): a refusal, any API error, or an empty answer returns the one
 * named sentence NARRATIVE_UNAVAILABLE and the proposer writes the section themselves.
 *
 * Request shape (claude-api skill, Opus 5.5): plain `messages.create`, non-streaming with
 * max_tokens 16000; `thinking` omitted (Opus 5.5 always thinks adaptively and rejects "disabled");
 * effort set explicitly because Opus 5.5 defaults to medium and the default may move.
 */
import Anthropic from '@anthropic-ai/sdk'

export const DEFAULT_NARRATIVE_MODEL = 'claude-opus-5-5'
export const NO_KEY_REASON = 'The AI narrative is not configured on this server (no Anthropic API key).'
export const NARRATIVE_UNAVAILABLE = 'Narrative unavailable — write it yourself'

/** Resolved at call time, so a changed environment needs no module reload. */
export function narrativeModel(): string {
  return process.env.SOLAR_NARRATIVE_MODEL || DEFAULT_NARRATIVE_MODEL
}

export interface NarrativeFacts {
  projectName: string; clientName: string
  dcKwp: number; acKw: number; batteryKwh: number | null
  year1Mwh: number; solarSharePct: number
  offerExclVat: string; financeOptions: string[]
}

export type NarrativeResult = { ok: true; text: string } | { ok: false; error: string }

const SYSTEM =
  'You write the "About this proposal" section of a commercial rooftop solar PV proposal for a South African client. ' +
  'Write 120 to 250 words of plain, professional English in two or three short paragraphs: no headings, no bullet points, no markdown. ' +
  'Use only the facts in the JSON the user sends. Never invent a number, a saving, a guarantee or a date. Prices exclude VAT. ' +
  'Do not promise savings; say they are estimates based on a modelled year.'

export function narrativeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** JSON-safe availability for a page to hand a client component (the button is disabled with the reason). */
export function narrativeStatus(): { narrativeAvailable: boolean; narrativeReason: string | null } {
  const available = narrativeAvailable()
  return { narrativeAvailable: available, narrativeReason: available ? null : NO_KEY_REASON }
}

export async function draftNarrative(facts: NarrativeFacts): Promise<NarrativeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, error: NO_KEY_REASON }
  try {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: narrativeModel(),
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
    })
    if (res.stop_reason === 'refusal') {
      console.warn('[solar-narrative] refused', { category: res.stop_details?.category ?? null })
      return { ok: false, error: NARRATIVE_UNAVAILABLE }
    }
    const text = res.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('\n')
      .trim()
    if (!text) return { ok: false, error: NARRATIVE_UNAVAILABLE }
    return { ok: true, text: text.slice(0, 8000) }
  } catch (e) {
    // Read defensively: this catch must never throw (Anthropic.APIError subclasses carry `status`).
    const status = typeof (e as { status?: unknown } | null)?.status === 'number' ? (e as { status: number }).status : undefined
    console.error('[solar-narrative] failed', { status, err: e instanceof Error ? e.name : 'unknown' })
    return { ok: false, error: NARRATIVE_UNAVAILABLE }
  }
}
