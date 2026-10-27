import { parseRepeatingGroupKey } from './engine';
import type { Field, Template } from './types';
import type { InspectionAttachments } from './engine';

export interface MissingItem {
  sectionId: string;
  fieldId: string;
  sectionTitle: string;
  /** The entry as the inspector sees it, e.g. "Battery voltage" or "Circuits #2 · Rating". */
  label: string;
  /** What would complete it, e.g. "Enter a value", "1 of 3 photos added", "Sign". */
  need: string;
}

function findField(template: Template, sectionId: string, fieldId: string): { field: Field; sectionTitle: string } | null {
  const section = template.sections.find((s) => s.section_id === sectionId);
  if (!section) return null;
  const all = [...(section.fields ?? []), ...(section.subsections ?? []).flatMap((ss) => ss.fields)];
  const f = all.find((x) => x.field_id === fieldId);
  return f ? { field: f, sectionTitle: section.title } : null;
}

function needFor(field: Field, count: number): string {
  switch (field.type) {
    case 'photo':
    case 'file': {
      const noun = field.type === 'photo' ? 'photo' : 'file';
      const min = Math.max(field.min_count ?? 1, 1);
      if (min === 1) return `Add a ${noun}`;
      return `${count} of ${min} ${noun}s added`;
    }
    case 'signature':
      return 'Sign';
    case 'pass_fail':
      return 'Mark pass, fail or N/A';
    case 'number':
      return 'Enter a value';
    case 'dropdown':
    case 'multi_select':
      return 'Choose an option';
    case 'date':
      return 'Pick a date';
    case 'repeating_group':
      return `Add ${Math.max(field.min_count ?? 1, 1) === 1 ? 'an entry' : `at least ${field.min_count} entries`}`;
    default:
      return 'Fill in';
  }
}

/**
 * Turns the engine's missingRequired list into sentences a person can act on, in template order.
 *
 * The capture page used to show only a count and jump to the first gap for two seconds, so a form
 * whose only gap was a signature at the bottom of a section, or a reading with a photo but no value,
 * looked complete while Submit kept refusing it (MINISUB 1 and Main DB 1.1, 2026-10-12).
 */
export function describeMissing(
  template: Template,
  missing: { sectionId: string; fieldId: string; kind?: 'result' }[],
  attachments: InspectionAttachments = {},
): MissingItem[] {
  return missing.map((m) => {
    const rg = parseRepeatingGroupKey(m.fieldId);
    if (rg) {
      const group = findField(template, m.sectionId, rg.group);
      const sub = group?.field.fields?.find((f) => f.field_id === rg.sub);
      const count = (attachments.photos ?? []).filter((p) => p.section_id === m.sectionId && p.field_id === m.fieldId).length;
      return {
        sectionId: m.sectionId,
        fieldId: m.fieldId,
        sectionTitle: group?.sectionTitle ?? m.sectionId,
        label: `${group?.field.label ?? rg.group} #${rg.index + 1} · ${sub?.label ?? rg.sub}`,
        need: sub ? needFor(sub, count) : 'Fill in',
      };
    }
    const found = findField(template, m.sectionId, m.fieldId);
    const count =
      found?.field.type === 'signature'
        ? (attachments.signatures ?? []).filter((s) => s.section_id === m.sectionId && s.field_id === m.fieldId).length
        : (attachments.photos ?? []).filter((p) => p.section_id === m.sectionId && p.field_id === m.fieldId).length;
    return {
      sectionId: m.sectionId,
      fieldId: m.fieldId,
      sectionTitle: found?.sectionTitle ?? m.sectionId,
      label: String(found?.field.label ?? m.fieldId),
      need: m.kind === 'result' ? 'Mark pass, fail or N/A' : found ? needFor(found.field, count) : 'Fill in',
    };
  });
}
