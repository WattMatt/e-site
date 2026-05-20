import { describe, it, expect } from 'vitest';
import { nodeSchema } from './node-schema';

// Minimal valid base fields shared across kinds
const base = {
  project_id: '00000000-0000-0000-0000-000000000001',
  organisation_id: '00000000-0000-0000-0000-000000000002',
  code: 'MB-01',
};

describe('nodeSchema', () => {
  it('accepts a valid tenant_db node with shop_number', () => {
    expect(() =>
      nodeSchema.parse({ ...base, kind: 'tenant_db', shop_number: 'S001' }),
    ).not.toThrow();
  });

  it('accepts a valid main_board node', () => {
    expect(() =>
      nodeSchema.parse({ ...base, kind: 'main_board' }),
    ).not.toThrow();
  });

  it('accepts a valid common_area_board node', () => {
    expect(() =>
      nodeSchema.parse({ ...base, kind: 'common_area_board' }),
    ).not.toThrow();
  });

  it('accepts a valid rmu node', () => {
    expect(() =>
      nodeSchema.parse({ ...base, kind: 'rmu' }),
    ).not.toThrow();
  });

  it('accepts a valid mini_sub node', () => {
    expect(() =>
      nodeSchema.parse({ ...base, kind: 'mini_sub' }),
    ).not.toThrow();
  });

  it('accepts a valid generator node', () => {
    expect(() =>
      nodeSchema.parse({ ...base, kind: 'generator' }),
    ).not.toThrow();
  });

  it('rejects a tenant_db node missing shop_number', () => {
    expect(() =>
      nodeSchema.parse({ ...base, kind: 'tenant_db' }),
    ).toThrow(/shop_number/);
  });

  it('rejects a node with an unknown kind', () => {
    expect(() =>
      nodeSchema.parse({ ...base, kind: 'transformer' }),
    ).toThrow();
  });
});
