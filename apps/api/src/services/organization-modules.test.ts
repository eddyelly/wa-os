import { describe, expect, it } from 'vitest';
import { businessModuleSchema, updateOrganizationRequestSchema } from '@waos/shared';

describe('modules schemas', () => {
  it('accepts appointments and shop', () => {
    expect(businessModuleSchema.parse('appointments')).toBe('appointments');
    expect(businessModuleSchema.parse('shop')).toBe('shop');
  });

  it('rejects unknown modules', () => {
    expect(() => businessModuleSchema.parse('billing')).toThrow();
  });

  it('org update accepts a module list and dedupes it', () => {
    const parsed = updateOrganizationRequestSchema.parse({
      modules: ['shop', 'shop', 'appointments'],
    });
    expect(parsed.modules).toEqual(['shop', 'appointments']);
  });

  it('org update rejects an empty module list', () => {
    expect(() => updateOrganizationRequestSchema.parse({ modules: [] })).toThrow();
  });
});
