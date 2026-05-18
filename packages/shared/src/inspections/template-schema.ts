import { z } from 'zod';
import type { Field } from './types';

const fieldTypeEnum = z.enum([
  'pass_fail','number','text','textarea','dropdown','multi_select','date',
  'photo','signature','file','header','computed','repeating_group',
]);

// fieldSchema is z.lazy so the `fields` array on a repeating_group field
// can recursively reference fieldSchema itself. The refine block below
// enforces two repeating_group invariants: (1) non-empty fields[],
// (2) no nested repeating_groups (single level only in v1).
const fieldSchema: z.ZodType<Field> = z.lazy(() =>
  z.object({
    field_id: z.string().regex(/^[a-z0-9_]+$/, 'field_id must be snake_case'),
    label: z.string().min(1),
    type: fieldTypeEnum,
    required: z.boolean().optional(),
    unit: z.string().optional(),
    pass_when: z.string().optional(),
    options: z.array(z.string()).optional(),
    min_count: z.number().int().positive().optional(),
    max_count: z.number().int().positive().optional(),
    conditional_on: z.union([
      z.object({ field_id: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }),
      z.object({ field_id: z.string(), not_equals: z.union([z.string(), z.number(), z.boolean()]) }),
      z.object({ field_id: z.string(), greater_than: z.number() }),
      z.object({ field_id: z.string(), less_than: z.number() }),
      z.object({ field_id: z.string(), in: z.array(z.union([z.string(), z.number()])).min(1) }),
    ]).optional(),
    help_text: z.string().optional(),
    default_value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    formula: z.string().optional(),
    sans_ref: z.string().optional(),
    required_qualifications: z.array(
      z.enum(['registered_person','master_installation_electrician','pr_eng','witness','client']),
    ).optional(),
    fields: z.array(fieldSchema).optional(),
    item_label_template: z.string().optional(),
  }).refine((f) => {
    if (f.type !== 'repeating_group') return true;
    if (!f.fields || f.fields.length === 0) return false;
    // v1: disallow nested repeating_groups
    if (f.fields.some((sf) => sf.type === 'repeating_group')) return false;
    return true;
  }, {
    message: 'repeating_group requires non-empty fields[] and may not contain nested repeating_group entries',
  }),
);

// Same union shape as field.conditional_on — both subsections and sections
// can be conditionally hidden by an upstream answer.
const conditionalOnSchema = z.union([
  z.object({ field_id: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ field_id: z.string(), not_equals: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ field_id: z.string(), greater_than: z.number() }),
  z.object({ field_id: z.string(), less_than: z.number() }),
  z.object({ field_id: z.string(), in: z.array(z.union([z.string(), z.number()])).min(1) }),
]);

const subsectionSchema = z.object({
  subsection_id: z.string().regex(/^[a-z0-9_]+$/, 'subsection_id must be snake_case'),
  title: z.string().min(1),
  fields: z.array(fieldSchema).min(1),
  conditional_on: conditionalOnSchema.optional(),
});

const sectionSchema = z.object({
  section_id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(1),
  fields: z.array(fieldSchema),
  subsections: z.array(subsectionSchema).optional(),
  conditional_on: conditionalOnSchema.optional(),
}).refine(
  (s) => s.fields.length > 0 || (s.subsections?.length ?? 0) > 0,
  { message: 'Section must have at least one field or subsection' },
);

const brandingSchema = z.object({
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'accent_color must be 6-char hex (e.g. #0a5f4e)').optional(),
  cover_page: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    company_name: z.string().optional(),
    logo_url: z.string().url().optional(),
  }).optional(),
});

export const templateSchema = z.object({
  template_id: z.string().regex(/^[a-z0-9-]+$/, 'template_id must be kebab-case'),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+(\.\d+)?$/, 'version must be semver-ish (e.g. 1.0 or 1.0.1)'),
  applies_to_node_types: z.array(z.enum(['board','source','any'])).min(1),
  node_subtypes: z.array(z.string()).optional(),
  sans_reference: z.string().optional(),
  deliverable_type: z.enum(['coc','inspection_only','factory_test']),
  requires_separate_verifier: z.boolean().optional(),
  sections: z.array(sectionSchema).min(1),
  branding: brandingSchema.optional(),
});

export type ParsedTemplate = z.infer<typeof templateSchema>;
