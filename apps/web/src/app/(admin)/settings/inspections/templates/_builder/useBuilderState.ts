'use client';
import { useReducer, useCallback } from 'react';
import { templateSchema } from '@esite/shared';
import type { z } from 'zod';

export type TemplateDraft = z.infer<typeof templateSchema>;
type Section = TemplateDraft['sections'][number];
type SectionField = Section['fields'][number];

type BuilderAction =
  | {
      type: 'SET_METADATA';
      patch: Partial<
        Pick<
          TemplateDraft,
          | 'template_id'
          | 'version'
          | 'name'
          | 'deliverable_type'
          | 'sans_reference'
          | 'branding'
          | 'applies_to_node_types'
          | 'node_subtypes'
          | 'requires_separate_verifier'
        >
      >;
    }
  | { type: 'HYDRATE_DRAFT'; draft: TemplateDraft }
  | { type: 'ADD_SECTION' }
  | { type: 'REMOVE_SECTION'; sectionId: string }
  | { type: 'MOVE_SECTION'; sectionId: string; direction: 'up' | 'down' }
  | { type: 'UPDATE_SECTION'; sectionId: string; patch: { title?: string; section_id?: string } }
  | { type: 'ADD_FIELD'; sectionId: string; field: SectionField }
  | { type: 'REMOVE_FIELD'; sectionId: string; fieldId: string }
  | { type: 'MOVE_FIELD'; sectionId: string; fieldId: string; direction: 'up' | 'down' }
  | { type: 'UPDATE_FIELD'; sectionId: string; fieldId: string; patch: Record<string, unknown> }
  | { type: 'INSERT_FIELDS_AFTER'; sectionId: string; afterFieldId: string; fields: Section['fields'] };

function reducer(state: Partial<TemplateDraft>, action: BuilderAction): Partial<TemplateDraft> {
  switch (action.type) {
    case 'SET_METADATA':
      return { ...state, ...action.patch };

    case 'HYDRATE_DRAFT':
      return action.draft;

    case 'ADD_SECTION': {
      const newSection: Section = {
        section_id: `section_${(state.sections?.length ?? 0) + 1}`,
        title: 'New section',
        fields: [],
      };
      return { ...state, sections: [...(state.sections ?? []), newSection] };
    }

    case 'REMOVE_SECTION':
      return {
        ...state,
        sections: (state.sections ?? []).filter((s: Section) => s.section_id !== action.sectionId),
      };

    case 'MOVE_SECTION': {
      const sections = [...(state.sections ?? [])];
      const idx = sections.findIndex((s: Section) => s.section_id === action.sectionId);
      if (idx === -1) return state;
      const target = action.direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= sections.length) return state;
      [sections[idx], sections[target]] = [sections[target], sections[idx]];
      return { ...state, sections };
    }

    case 'UPDATE_SECTION':
      return {
        ...state,
        sections: (state.sections ?? []).map((s: Section) =>
          s.section_id === action.sectionId ? { ...s, ...action.patch } : s
        ),
      };

    case 'ADD_FIELD':
      return {
        ...state,
        sections: (state.sections ?? []).map((s: Section) =>
          s.section_id === action.sectionId
            ? { ...s, fields: [...s.fields, action.field] }
            : s
        ),
      };

    case 'REMOVE_FIELD':
      return {
        ...state,
        sections: (state.sections ?? []).map((s: Section) =>
          s.section_id === action.sectionId
            ? { ...s, fields: s.fields.filter((f: SectionField) => f.field_id !== action.fieldId) }
            : s
        ),
      };

    case 'MOVE_FIELD': {
      return {
        ...state,
        sections: (state.sections ?? []).map((s: Section) => {
          if (s.section_id !== action.sectionId) return s;
          const fields = [...s.fields];
          const idx = fields.findIndex((f: SectionField) => f.field_id === action.fieldId);
          if (idx === -1) return s;
          const target = action.direction === 'up' ? idx - 1 : idx + 1;
          if (target < 0 || target >= fields.length) return s;
          [fields[idx], fields[target]] = [fields[target], fields[idx]];
          return { ...s, fields };
        }),
      };
    }

    case 'UPDATE_FIELD':
      return {
        ...state,
        sections: (state.sections ?? []).map((s: Section) =>
          s.section_id === action.sectionId
            ? {
                ...s,
                fields: s.fields.map((f: SectionField) =>
                  f.field_id === action.fieldId
                    ? ({ ...f, ...action.patch } as SectionField)
                    : f
                ),
              }
            : s
        ),
      };

    case 'INSERT_FIELDS_AFTER':
      return {
        ...state,
        sections: (state.sections ?? []).map((s: Section) => {
          if (s.section_id !== action.sectionId) return s;
          const idx = s.fields.findIndex((f: SectionField) => f.field_id === action.afterFieldId);
          if (idx === -1) return s;
          return {
            ...s,
            fields: [
              ...s.fields.slice(0, idx + 1),
              ...action.fields,
              ...s.fields.slice(idx + 1),
            ],
          };
        }),
      };
  }
}

const EMPTY_DRAFT: Partial<TemplateDraft> = {
  template_id: '',
  version: '1.0',
  name: '',
  deliverable_type: 'inspection_only',
  applies_to_node_types: ['any'],
  sections: [],
};

export function useBuilderState(initialDraft?: Partial<TemplateDraft>) {
  const [state, dispatch] = useReducer(reducer, initialDraft ?? EMPTY_DRAFT);

  const setMetadata = useCallback(
    (
      patch: Partial<
        Pick<
          TemplateDraft,
          | 'template_id'
          | 'version'
          | 'name'
          | 'deliverable_type'
          | 'sans_reference'
          | 'branding'
          | 'applies_to_node_types'
          | 'node_subtypes'
          | 'requires_separate_verifier'
        >
      >
    ) => {
      dispatch({ type: 'SET_METADATA', patch });
    },
    []
  );

  const hydrate = useCallback(
    (draft: TemplateDraft) => dispatch({ type: 'HYDRATE_DRAFT', draft }),
    []
  );

  const addSection = useCallback(() => dispatch({ type: 'ADD_SECTION' }), []);

  const removeSection = useCallback(
    (sectionId: string) => dispatch({ type: 'REMOVE_SECTION', sectionId }),
    []
  );

  const moveSection = useCallback(
    (sectionId: string, direction: 'up' | 'down') =>
      dispatch({ type: 'MOVE_SECTION', sectionId, direction }),
    []
  );

  const updateSection = useCallback(
    (sectionId: string, patch: { title?: string; section_id?: string }) =>
      dispatch({ type: 'UPDATE_SECTION', sectionId, patch }),
    []
  );

  const addField = useCallback(
    (sectionId: string, field: SectionField) =>
      dispatch({ type: 'ADD_FIELD', sectionId, field }),
    []
  );

  const removeField = useCallback(
    (sectionId: string, fieldId: string) =>
      dispatch({ type: 'REMOVE_FIELD', sectionId, fieldId }),
    []
  );

  const moveField = useCallback(
    (sectionId: string, fieldId: string, direction: 'up' | 'down') =>
      dispatch({ type: 'MOVE_FIELD', sectionId, fieldId, direction }),
    []
  );

  const updateField = useCallback(
    (sectionId: string, fieldId: string, patch: Record<string, unknown>) =>
      dispatch({ type: 'UPDATE_FIELD', sectionId, fieldId, patch }),
    []
  );

  const insertFieldsAfter = useCallback(
    (sectionId: string, afterFieldId: string, fields: Section['fields']) =>
      dispatch({ type: 'INSERT_FIELDS_AFTER', sectionId, afterFieldId, fields }),
    []
  );

  return {
    state,
    setMetadata,
    hydrate,
    addSection,
    removeSection,
    moveSection,
    updateSection,
    addField,
    removeField,
    moveField,
    updateField,
    insertFieldsAfter,
  };
}
