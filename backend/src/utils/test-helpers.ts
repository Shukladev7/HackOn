/**
 * Test helpers for property-based testing with fast-check and vitest.
 * Import these utilities in your .test.ts files for PBT support.
 */
import fc from 'fast-check';

/**
 * Default fast-check parameters for property tests.
 * Provides a good balance of coverage vs. speed for CI.
 */
export const defaultPbtParams: fc.Parameters<unknown> = {
  numRuns: 100,
  verbose: fc.VerbosityLevel.None,
};

/**
 * Extended parameters for thorough property testing (local dev).
 */
export const thoroughPbtParams: fc.Parameters<unknown> = {
  numRuns: 1000,
  verbose: fc.VerbosityLevel.VeryVerbose,
};

/**
 * Geo-coordinate arbitrary within valid ranges.
 */
export const geoCoordinateArb = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

/**
 * Positive finite number arbitrary.
 */
export const positiveFiniteArb = fc.double({ min: 0.001, max: 1e6, noNaN: true });

/**
 * Probability (0.0 to 1.0) arbitrary.
 */
export const probabilityArb = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * ISO 8601 date string arbitrary.
 */
export const isoDateArb = fc.date().map((d) => d.toISOString());

export { fc };
