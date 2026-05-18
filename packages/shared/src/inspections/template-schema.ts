import { z } from 'zod';

const fieldTypeEnum = z.enum([
  'pass_fail','number','text','textarea','dropdown','multi_select','date',
  'photo','signature','file','header','computed',
]);

const fieldSchema = z.object({
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
});

const sectionSchema = z.object({
  section_id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(1),
  fields: z.array(fieldSchema).min(1),
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
});

export type ParsedTemplate = z.infer<typeof templateSchema>;
