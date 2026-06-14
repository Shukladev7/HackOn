import { describe, it, expect } from 'vitest';
import { fc, defaultPbtParams, probabilityArb } from './utils/test-helpers';

describe('Backend setup', () => {
  it('should have the project configured correctly', () => {
    expect(true).toBe(true);
  });

  it('should support property-based testing with fast-check', () => {
    fc.assert(
      fc.property(probabilityArb, (p) => {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }),
      defaultPbtParams
    );
  });
});
