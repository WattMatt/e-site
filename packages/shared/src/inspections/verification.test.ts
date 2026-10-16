import { describe, it, expect } from 'vitest';
import { requiresSeparateVerifier } from './verification';

describe('requiresSeparateVerifier (mirrors inspections.template_requires_separate_verifier)', () => {
  it('defaults to true for CoC and factory-test deliverables', () => {
    expect(requiresSeparateVerifier('coc')).toBe(true);
    expect(requiresSeparateVerifier('factory_test')).toBe(true);
    expect(requiresSeparateVerifier('inspection_only')).toBe(false);
  });
  it("follows the template's own boolean flag either way", () => {
    expect(requiresSeparateVerifier('coc', false)).toBe(false);
    expect(requiresSeparateVerifier('inspection_only', true)).toBe(true);
  });
  it('ignores a flag that is not a boolean, as the database does', () => {
    expect(requiresSeparateVerifier('coc', 'false')).toBe(true);
    expect(requiresSeparateVerifier(null, null)).toBe(false);
  });
});
