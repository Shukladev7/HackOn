/**
 * Feature Generator Service for Flash Deal Eligibility Engine.
 *
 * Produces complete, validated feature vectors from product data,
 * ProductPassport records, or seed configurations.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */

import { FeatureVector, ValidationResult } from './types';
import { ProductPassport } from '../../models/ProductPassport';
import { FlashDealSeedScenario } from '../../models/FlashDealSeedScenario';

// ─── Feature Bounds ──────────────────────────────────────────────────────────

export const FEATURE_BOUNDS = {
  mrp: { min: 500, max: 150000 },
  currentMarketPrice: { min: 200, max: 140000 },
  brandPopularityScore: { min: 0, max: 100 },
  damageScore: { min: 0, max: 100 },
  batteryHealth: { min: 0, max: 100 },
  wishlistCount: { min: 0, max: 500 },
  cartCount: { min: 0, max: 200 },
  nearbyInterestedBuyers: { min: 0, max: 50 },
  historicalConversionRate: { min: 0.0, max: 1.0 },
  demandDensity: { min: 0, max: 100 },
  distanceToBuyers: { min: 0.5, max: 100 },
  expectedRecoveryValue: { min: 100, max: 140000 },
  warehouseCostAvoided: { min: 50, max: 500 },
  deliveryCostSaved: { min: 20, max: 300 },
} as const;

export const CATEGORIES = ['Electronics', 'Fashion', 'Home Appliances', 'Books', 'Toys'] as const;
export const CITIES = ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata'] as const;
export const INSPECTION_GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export const PACKAGING_CONDITIONS = ['Original', 'Damaged', 'Missing'] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a random number between min and max (inclusive for integers, continuous for floats).
 */
function randomInRange(min: number, max: number, isFloat = false): number {
  if (isFloat) {
    return min + Math.random() * (max - min);
  }
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Picks a random element from an array.
 */
function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Clamps a value to [min, max] and logs when a correction is made.
 */
export function clampToRange(value: number, min: number, max: number, fieldName: string): number {
  if (value < min) {
    console.warn(
      `[FeatureGenerator] Clamped ${fieldName}: ${value} → ${min} (below minimum)`
    );
    return min;
  }
  if (value > max) {
    console.warn(
      `[FeatureGenerator] Clamped ${fieldName}: ${value} → ${max} (above maximum)`
    );
    return max;
  }
  return value;
}

/**
 * Generates a fully randomized feature vector within all defined bounds.
 * Requirements: 1.1, 1.3
 */
export function generateRandom(): FeatureVector {
  const mrp = randomInRange(FEATURE_BOUNDS.mrp.min, FEATURE_BOUNDS.mrp.max);
  // currentMarketPrice must not exceed MRP
  const marketPriceMax = Math.min(FEATURE_BOUNDS.currentMarketPrice.max, mrp);
  const currentMarketPrice = randomInRange(FEATURE_BOUNDS.currentMarketPrice.min, marketPriceMax);

  return {
    product: {
      category: randomPick(CATEGORIES),
      mrp,
      currentMarketPrice,
      brandPopularityScore: randomInRange(
        FEATURE_BOUNDS.brandPopularityScore.min,
        FEATURE_BOUNDS.brandPopularityScore.max
      ),
    },
    condition: {
      inspectionGrade: randomPick(INSPECTION_GRADES),
      packagingCondition: randomPick(PACKAGING_CONDITIONS),
      damageScore: randomInRange(FEATURE_BOUNDS.damageScore.min, FEATURE_BOUNDS.damageScore.max),
      batteryHealth: randomInRange(FEATURE_BOUNDS.batteryHealth.min, FEATURE_BOUNDS.batteryHealth.max),
    },
    demand: {
      wishlistCount: randomInRange(FEATURE_BOUNDS.wishlistCount.min, FEATURE_BOUNDS.wishlistCount.max),
      cartCount: randomInRange(FEATURE_BOUNDS.cartCount.min, FEATURE_BOUNDS.cartCount.max),
      nearbyInterestedBuyers: randomInRange(
        FEATURE_BOUNDS.nearbyInterestedBuyers.min,
        FEATURE_BOUNDS.nearbyInterestedBuyers.max
      ),
      historicalConversionRate: parseFloat(
        randomInRange(
          FEATURE_BOUNDS.historicalConversionRate.min,
          FEATURE_BOUNDS.historicalConversionRate.max,
          true
        ).toFixed(4)
      ),
    },
    location: {
      city: randomPick(CITIES),
      demandDensity: randomInRange(FEATURE_BOUNDS.demandDensity.min, FEATURE_BOUNDS.demandDensity.max),
      distanceToBuyers: parseFloat(
        randomInRange(
          FEATURE_BOUNDS.distanceToBuyers.min,
          FEATURE_BOUNDS.distanceToBuyers.max,
          true
        ).toFixed(2)
      ),
    },
    financial: {
      expectedRecoveryValue: randomInRange(
        FEATURE_BOUNDS.expectedRecoveryValue.min,
        FEATURE_BOUNDS.expectedRecoveryValue.max
      ),
      warehouseCostAvoided: randomInRange(
        FEATURE_BOUNDS.warehouseCostAvoided.min,
        FEATURE_BOUNDS.warehouseCostAvoided.max
      ),
      deliveryCostSaved: randomInRange(
        FEATURE_BOUNDS.deliveryCostSaved.min,
        FEATURE_BOUNDS.deliveryCostSaved.max
      ),
    },
    metadata: {
      source: 'random',
      syntheticFields: [],
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Loads a seed scenario from the database and returns its pre-configured features.
 * Requirements: 1.2
 */
export async function generateFromSeed(scenarioId: string): Promise<FeatureVector> {
  const scenario = await FlashDealSeedScenario.findOne({ scenarioId });

  if (!scenario) {
    throw new Error(`Seed scenario not found: ${scenarioId}`);
  }

  // Return the pre-configured features with source set to 'seed'
  const features = scenario.features;
  return {
    product: { ...features.product },
    condition: { ...features.condition },
    demand: { ...features.demand },
    location: { ...features.location },
    financial: { ...features.financial },
    metadata: {
      source: 'seed',
      syntheticFields: [],
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Loads a ProductPassport, extracts inspectionGrade and batteryHealth from the
 * most recent inspection, generates remaining features within bounds, and flags
 * synthetic fields in metadata.
 * Requirements: 1.5, 1.7
 */
export async function generateFromPassport(passportId: string): Promise<FeatureVector> {
  const passport = await ProductPassport.findOne({ passportId });

  if (!passport) {
    throw new Error(`Product passport not found: ${passportId}`);
  }

  const syntheticFields: string[] = [];

  // Extract from most recent inspection
  const latestInspection = passport.inspectionHistory?.length
    ? passport.inspectionHistory[passport.inspectionHistory.length - 1]
    : null;

  // Determine inspectionGrade
  let inspectionGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (latestInspection?.grade && INSPECTION_GRADES.includes(latestInspection.grade as any)) {
    inspectionGrade = latestInspection.grade as 'A' | 'B' | 'C' | 'D' | 'F';
  } else {
    inspectionGrade = randomPick(INSPECTION_GRADES);
    syntheticFields.push('condition.inspectionGrade');
  }

  // Determine batteryHealth
  let batteryHealth: number;
  if (latestInspection?.batteryHealth != null && !isNaN(latestInspection.batteryHealth)) {
    batteryHealth = clampToRange(
      latestInspection.batteryHealth,
      FEATURE_BOUNDS.batteryHealth.min,
      FEATURE_BOUNDS.batteryHealth.max,
      'condition.batteryHealth'
    );
  } else {
    batteryHealth = randomInRange(FEATURE_BOUNDS.batteryHealth.min, FEATURE_BOUNDS.batteryHealth.max);
    syntheticFields.push('condition.batteryHealth');
  }

  // Use passport category if available
  const category = passport.category && CATEGORIES.includes(passport.category as any)
    ? passport.category
    : randomPick(CATEGORIES);

  // Use passport city if available
  const city = passport.currentLocation?.city && CITIES.includes(passport.currentLocation.city as any)
    ? passport.currentLocation.city
    : randomPick(CITIES);

  // Generate remaining features within bounds
  const mrp = randomInRange(FEATURE_BOUNDS.mrp.min, FEATURE_BOUNDS.mrp.max);
  const marketPriceMax = Math.min(FEATURE_BOUNDS.currentMarketPrice.max, mrp);
  const currentMarketPrice = randomInRange(FEATURE_BOUNDS.currentMarketPrice.min, marketPriceMax);

  // Track which features are fully synthetic (not from passport)
  const syntheticRemaining = [
    'product.mrp',
    'product.currentMarketPrice',
    'product.brandPopularityScore',
    'condition.packagingCondition',
    'condition.damageScore',
    'demand.wishlistCount',
    'demand.cartCount',
    'demand.nearbyInterestedBuyers',
    'demand.historicalConversionRate',
    'location.demandDensity',
    'location.distanceToBuyers',
    'financial.expectedRecoveryValue',
    'financial.warehouseCostAvoided',
    'financial.deliveryCostSaved',
  ];
  syntheticFields.push(...syntheticRemaining);

  return {
    product: {
      category,
      mrp,
      currentMarketPrice,
      brandPopularityScore: randomInRange(
        FEATURE_BOUNDS.brandPopularityScore.min,
        FEATURE_BOUNDS.brandPopularityScore.max
      ),
    },
    condition: {
      inspectionGrade,
      packagingCondition: randomPick(PACKAGING_CONDITIONS),
      damageScore: randomInRange(FEATURE_BOUNDS.damageScore.min, FEATURE_BOUNDS.damageScore.max),
      batteryHealth,
    },
    demand: {
      wishlistCount: randomInRange(FEATURE_BOUNDS.wishlistCount.min, FEATURE_BOUNDS.wishlistCount.max),
      cartCount: randomInRange(FEATURE_BOUNDS.cartCount.min, FEATURE_BOUNDS.cartCount.max),
      nearbyInterestedBuyers: randomInRange(
        FEATURE_BOUNDS.nearbyInterestedBuyers.min,
        FEATURE_BOUNDS.nearbyInterestedBuyers.max
      ),
      historicalConversionRate: parseFloat(
        randomInRange(
          FEATURE_BOUNDS.historicalConversionRate.min,
          FEATURE_BOUNDS.historicalConversionRate.max,
          true
        ).toFixed(4)
      ),
    },
    location: {
      city,
      demandDensity: randomInRange(FEATURE_BOUNDS.demandDensity.min, FEATURE_BOUNDS.demandDensity.max),
      distanceToBuyers: parseFloat(
        randomInRange(
          FEATURE_BOUNDS.distanceToBuyers.min,
          FEATURE_BOUNDS.distanceToBuyers.max,
          true
        ).toFixed(2)
      ),
    },
    financial: {
      expectedRecoveryValue: randomInRange(
        FEATURE_BOUNDS.expectedRecoveryValue.min,
        FEATURE_BOUNDS.expectedRecoveryValue.max
      ),
      warehouseCostAvoided: randomInRange(
        FEATURE_BOUNDS.warehouseCostAvoided.min,
        FEATURE_BOUNDS.warehouseCostAvoided.max
      ),
      deliveryCostSaved: randomInRange(
        FEATURE_BOUNDS.deliveryCostSaved.min,
        FEATURE_BOUNDS.deliveryCostSaved.max
      ),
    },
    metadata: {
      source: 'passport',
      syntheticFields,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Validates that all fields exist and values are within defined bounds.
 * Requirements: 1.4
 */
export function validate(features: FeatureVector): ValidationResult {
  const errors: string[] = [];

  // Product features
  if (!features.product) {
    errors.push('Missing product features');
  } else {
    if (features.product.category == null || features.product.category === '') {
      errors.push('Missing product.category');
    }
    if (features.product.mrp == null) {
      errors.push('Missing product.mrp');
    } else if (features.product.mrp < FEATURE_BOUNDS.mrp.min || features.product.mrp > FEATURE_BOUNDS.mrp.max) {
      errors.push(
        `product.mrp out of range: ${features.product.mrp} (expected ${FEATURE_BOUNDS.mrp.min}–${FEATURE_BOUNDS.mrp.max})`
      );
    }
    if (features.product.currentMarketPrice == null) {
      errors.push('Missing product.currentMarketPrice');
    } else {
      if (
        features.product.currentMarketPrice < FEATURE_BOUNDS.currentMarketPrice.min ||
        features.product.currentMarketPrice > FEATURE_BOUNDS.currentMarketPrice.max
      ) {
        errors.push(
          `product.currentMarketPrice out of range: ${features.product.currentMarketPrice} (expected ${FEATURE_BOUNDS.currentMarketPrice.min}–${FEATURE_BOUNDS.currentMarketPrice.max})`
        );
      }
      if (features.product.mrp != null && features.product.currentMarketPrice > features.product.mrp) {
        errors.push(
          `product.currentMarketPrice (${features.product.currentMarketPrice}) exceeds product.mrp (${features.product.mrp})`
        );
      }
    }
    if (features.product.brandPopularityScore == null) {
      errors.push('Missing product.brandPopularityScore');
    } else if (
      features.product.brandPopularityScore < FEATURE_BOUNDS.brandPopularityScore.min ||
      features.product.brandPopularityScore > FEATURE_BOUNDS.brandPopularityScore.max
    ) {
      errors.push(
        `product.brandPopularityScore out of range: ${features.product.brandPopularityScore} (expected ${FEATURE_BOUNDS.brandPopularityScore.min}–${FEATURE_BOUNDS.brandPopularityScore.max})`
      );
    }
  }

  // Condition features
  if (!features.condition) {
    errors.push('Missing condition features');
  } else {
    if (!features.condition.inspectionGrade) {
      errors.push('Missing condition.inspectionGrade');
    } else if (!INSPECTION_GRADES.includes(features.condition.inspectionGrade as any)) {
      errors.push(
        `Invalid condition.inspectionGrade: ${features.condition.inspectionGrade} (expected one of ${INSPECTION_GRADES.join(', ')})`
      );
    }
    if (!features.condition.packagingCondition) {
      errors.push('Missing condition.packagingCondition');
    } else if (!PACKAGING_CONDITIONS.includes(features.condition.packagingCondition as any)) {
      errors.push(
        `Invalid condition.packagingCondition: ${features.condition.packagingCondition} (expected one of ${PACKAGING_CONDITIONS.join(', ')})`
      );
    }
    if (features.condition.damageScore == null) {
      errors.push('Missing condition.damageScore');
    } else if (
      features.condition.damageScore < FEATURE_BOUNDS.damageScore.min ||
      features.condition.damageScore > FEATURE_BOUNDS.damageScore.max
    ) {
      errors.push(
        `condition.damageScore out of range: ${features.condition.damageScore} (expected ${FEATURE_BOUNDS.damageScore.min}–${FEATURE_BOUNDS.damageScore.max})`
      );
    }
    if (features.condition.batteryHealth == null) {
      errors.push('Missing condition.batteryHealth');
    } else if (
      features.condition.batteryHealth < FEATURE_BOUNDS.batteryHealth.min ||
      features.condition.batteryHealth > FEATURE_BOUNDS.batteryHealth.max
    ) {
      errors.push(
        `condition.batteryHealth out of range: ${features.condition.batteryHealth} (expected ${FEATURE_BOUNDS.batteryHealth.min}–${FEATURE_BOUNDS.batteryHealth.max})`
      );
    }
  }

  // Demand features
  if (!features.demand) {
    errors.push('Missing demand features');
  } else {
    if (features.demand.wishlistCount == null) {
      errors.push('Missing demand.wishlistCount');
    } else if (
      features.demand.wishlistCount < FEATURE_BOUNDS.wishlistCount.min ||
      features.demand.wishlistCount > FEATURE_BOUNDS.wishlistCount.max
    ) {
      errors.push(
        `demand.wishlistCount out of range: ${features.demand.wishlistCount} (expected ${FEATURE_BOUNDS.wishlistCount.min}–${FEATURE_BOUNDS.wishlistCount.max})`
      );
    }
    if (features.demand.cartCount == null) {
      errors.push('Missing demand.cartCount');
    } else if (
      features.demand.cartCount < FEATURE_BOUNDS.cartCount.min ||
      features.demand.cartCount > FEATURE_BOUNDS.cartCount.max
    ) {
      errors.push(
        `demand.cartCount out of range: ${features.demand.cartCount} (expected ${FEATURE_BOUNDS.cartCount.min}–${FEATURE_BOUNDS.cartCount.max})`
      );
    }
    if (features.demand.nearbyInterestedBuyers == null) {
      errors.push('Missing demand.nearbyInterestedBuyers');
    } else if (
      features.demand.nearbyInterestedBuyers < FEATURE_BOUNDS.nearbyInterestedBuyers.min ||
      features.demand.nearbyInterestedBuyers > FEATURE_BOUNDS.nearbyInterestedBuyers.max
    ) {
      errors.push(
        `demand.nearbyInterestedBuyers out of range: ${features.demand.nearbyInterestedBuyers} (expected ${FEATURE_BOUNDS.nearbyInterestedBuyers.min}–${FEATURE_BOUNDS.nearbyInterestedBuyers.max})`
      );
    }
    if (features.demand.historicalConversionRate == null) {
      errors.push('Missing demand.historicalConversionRate');
    } else if (
      features.demand.historicalConversionRate < FEATURE_BOUNDS.historicalConversionRate.min ||
      features.demand.historicalConversionRate > FEATURE_BOUNDS.historicalConversionRate.max
    ) {
      errors.push(
        `demand.historicalConversionRate out of range: ${features.demand.historicalConversionRate} (expected ${FEATURE_BOUNDS.historicalConversionRate.min}–${FEATURE_BOUNDS.historicalConversionRate.max})`
      );
    }
  }

  // Location features
  if (!features.location) {
    errors.push('Missing location features');
  } else {
    if (!features.location.city) {
      errors.push('Missing location.city');
    }
    if (features.location.demandDensity == null) {
      errors.push('Missing location.demandDensity');
    } else if (
      features.location.demandDensity < FEATURE_BOUNDS.demandDensity.min ||
      features.location.demandDensity > FEATURE_BOUNDS.demandDensity.max
    ) {
      errors.push(
        `location.demandDensity out of range: ${features.location.demandDensity} (expected ${FEATURE_BOUNDS.demandDensity.min}–${FEATURE_BOUNDS.demandDensity.max})`
      );
    }
    if (features.location.distanceToBuyers == null) {
      errors.push('Missing location.distanceToBuyers');
    } else if (
      features.location.distanceToBuyers < FEATURE_BOUNDS.distanceToBuyers.min ||
      features.location.distanceToBuyers > FEATURE_BOUNDS.distanceToBuyers.max
    ) {
      errors.push(
        `location.distanceToBuyers out of range: ${features.location.distanceToBuyers} (expected ${FEATURE_BOUNDS.distanceToBuyers.min}–${FEATURE_BOUNDS.distanceToBuyers.max})`
      );
    }
  }

  // Financial features
  if (!features.financial) {
    errors.push('Missing financial features');
  } else {
    if (features.financial.expectedRecoveryValue == null) {
      errors.push('Missing financial.expectedRecoveryValue');
    } else if (
      features.financial.expectedRecoveryValue < FEATURE_BOUNDS.expectedRecoveryValue.min ||
      features.financial.expectedRecoveryValue > FEATURE_BOUNDS.expectedRecoveryValue.max
    ) {
      errors.push(
        `financial.expectedRecoveryValue out of range: ${features.financial.expectedRecoveryValue} (expected ${FEATURE_BOUNDS.expectedRecoveryValue.min}–${FEATURE_BOUNDS.expectedRecoveryValue.max})`
      );
    }
    if (features.financial.warehouseCostAvoided == null) {
      errors.push('Missing financial.warehouseCostAvoided');
    } else if (
      features.financial.warehouseCostAvoided < FEATURE_BOUNDS.warehouseCostAvoided.min ||
      features.financial.warehouseCostAvoided > FEATURE_BOUNDS.warehouseCostAvoided.max
    ) {
      errors.push(
        `financial.warehouseCostAvoided out of range: ${features.financial.warehouseCostAvoided} (expected ${FEATURE_BOUNDS.warehouseCostAvoided.min}–${FEATURE_BOUNDS.warehouseCostAvoided.max})`
      );
    }
    if (features.financial.deliveryCostSaved == null) {
      errors.push('Missing financial.deliveryCostSaved');
    } else if (
      features.financial.deliveryCostSaved < FEATURE_BOUNDS.deliveryCostSaved.min ||
      features.financial.deliveryCostSaved > FEATURE_BOUNDS.deliveryCostSaved.max
    ) {
      errors.push(
        `financial.deliveryCostSaved out of range: ${features.financial.deliveryCostSaved} (expected ${FEATURE_BOUNDS.deliveryCostSaved.min}–${FEATURE_BOUNDS.deliveryCostSaved.max})`
      );
    }
  }

  // Metadata
  if (!features.metadata) {
    errors.push('Missing metadata');
  } else {
    if (!features.metadata.source) {
      errors.push('Missing metadata.source');
    } else if (!['passport', 'seed', 'random'].includes(features.metadata.source)) {
      errors.push(`Invalid metadata.source: ${features.metadata.source}`);
    }
    if (!features.metadata.generatedAt) {
      errors.push('Missing metadata.generatedAt');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
