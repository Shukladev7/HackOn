import { FlashDealSeedScenario, IFlashDealSeedScenario } from '../models/FlashDealSeedScenario';
import { DispositionDecision } from '../models/FlashDealEvaluation';

/**
 * Seed scenarios for the Flash Deal Eligibility Engine.
 * Covers all 5 disposition decisions with diverse categories and cities.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

interface SeedScenarioInput {
  scenarioId: string;
  name: string;
  description: string;
  category: string;
  city: string;
  features: IFlashDealSeedScenario['features'];
  expectedDecision: DispositionDecision;
}

const SEED_SCENARIOS: SeedScenarioInput[] = [
  {
    scenarioId: 'flash-deal-01',
    name: 'Premium Smartphone - Excellent Condition',
    description:
      'A high-end smartphone in excellent condition with strong local demand in Mumbai. Grade A inspection, high wishlist activity, and strong buyer density make this an ideal flash deal candidate with high recovery potential.',
    category: 'Electronics',
    city: 'Mumbai',
    features: {
      product: {
        category: 'Electronics',
        mrp: 89999,
        currentMarketPrice: 75000,
        brandPopularityScore: 92,
      },
      condition: {
        inspectionGrade: 'A',
        packagingCondition: 'Original',
        damageScore: 5,
        batteryHealth: 97,
      },
      demand: {
        wishlistCount: 420,
        cartCount: 85,
        nearbyInterestedBuyers: 38,
        historicalConversionRate: 0.85,
      },
      location: {
        city: 'Mumbai',
        demandDensity: 92,
        distanceToBuyers: 4,
      },
      financial: {
        expectedRecoveryValue: 72000,
        warehouseCostAvoided: 380,
        deliveryCostSaved: 260,
      },
      metadata: {
        source: 'seed',
        syntheticFields: [],
        generatedAt: new Date().toISOString(),
      },
    },
    expectedDecision: 'FLASH_DEAL',
  },
  {
    scenarioId: 'flash-deal-02',
    name: 'Designer Jacket - Minor Wear',
    description:
      'A premium fashion item with minor wear in Delhi. Grade B inspection with moderate demand signals. Suitable for Amazon Renewed listing due to brand value and acceptable condition despite damaged packaging.',
    category: 'Fashion',
    city: 'Delhi',
    features: {
      product: {
        category: 'Fashion',
        mrp: 12999,
        currentMarketPrice: 9500,
        brandPopularityScore: 78,
      },
      condition: {
        inspectionGrade: 'B',
        packagingCondition: 'Damaged',
        damageScore: 22,
        batteryHealth: 85,
      },
      demand: {
        wishlistCount: 180,
        cartCount: 40,
        nearbyInterestedBuyers: 15,
        historicalConversionRate: 0.55,
      },
      location: {
        city: 'Delhi',
        demandDensity: 65,
        distanceToBuyers: 12,
      },
      financial: {
        expectedRecoveryValue: 7200,
        warehouseCostAvoided: 200,
        deliveryCostSaved: 140,
      },
      metadata: {
        source: 'seed',
        syntheticFields: [],
        generatedAt: new Date().toISOString(),
      },
    },
    expectedDecision: 'AMAZON_RENEWED',
  },
  {
    scenarioId: 'flash-deal-03',
    name: 'Bluetooth Speaker - Fair Condition',
    description:
      'A mid-range electronics product in fair condition in Bangalore. Grade C inspection with moderate demand but missing packaging. Routes to normal resale channel due to condition-grade constraints.',
    category: 'Electronics',
    city: 'Bangalore',
    features: {
      product: {
        category: 'Electronics',
        mrp: 4999,
        currentMarketPrice: 2800,
        brandPopularityScore: 55,
      },
      condition: {
        inspectionGrade: 'C',
        packagingCondition: 'Missing',
        damageScore: 45,
        batteryHealth: 60,
      },
      demand: {
        wishlistCount: 80,
        cartCount: 20,
        nearbyInterestedBuyers: 12,
        historicalConversionRate: 0.35,
      },
      location: {
        city: 'Bangalore',
        demandDensity: 50,
        distanceToBuyers: 18,
      },
      financial: {
        expectedRecoveryValue: 1800,
        warehouseCostAvoided: 150,
        deliveryCostSaved: 80,
      },
      metadata: {
        source: 'seed',
        syntheticFields: [],
        generatedAt: new Date().toISOString(),
      },
    },
    expectedDecision: 'NORMAL_RESALE',
  },
  {
    scenarioId: 'flash-deal-04',
    name: 'Kitchen Mixer - Damaged Packaging',
    description:
      'A home appliance with significant damage in Hyderabad. Grade D with low demand signals, far from buyers, and low demand density. Routed to circular economy channels for component recovery.',
    category: 'Home Appliances',
    city: 'Hyderabad',
    features: {
      product: {
        category: 'Home Appliances',
        mrp: 7999,
        currentMarketPrice: 3500,
        brandPopularityScore: 30,
      },
      condition: {
        inspectionGrade: 'D',
        packagingCondition: 'Missing',
        damageScore: 70,
        batteryHealth: 45,
      },
      demand: {
        wishlistCount: 25,
        cartCount: 5,
        nearbyInterestedBuyers: 3,
        historicalConversionRate: 0.15,
      },
      location: {
        city: 'Hyderabad',
        demandDensity: 20,
        distanceToBuyers: 65,
      },
      financial: {
        expectedRecoveryValue: 1200,
        warehouseCostAvoided: 80,
        deliveryCostSaved: 45,
      },
      metadata: {
        source: 'seed',
        syntheticFields: [],
        generatedAt: new Date().toISOString(),
      },
    },
    expectedDecision: 'CIRCULAR_ROUTING',
  },
  {
    scenarioId: 'flash-deal-05',
    name: 'Budget Earbuds - Poor Condition',
    description:
      'A low-value electronics product in poor condition in Chennai. Grade F with virtually no demand, very far from potential buyers, and extremely low conversion probability. Returns to warehouse as standard RTO.',
    category: 'Electronics',
    city: 'Chennai',
    features: {
      product: {
        category: 'Electronics',
        mrp: 999,
        currentMarketPrice: 300,
        brandPopularityScore: 10,
      },
      condition: {
        inspectionGrade: 'F',
        packagingCondition: 'Missing',
        damageScore: 90,
        batteryHealth: 15,
      },
      demand: {
        wishlistCount: 5,
        cartCount: 0,
        nearbyInterestedBuyers: 0,
        historicalConversionRate: 0.03,
      },
      location: {
        city: 'Chennai',
        demandDensity: 8,
        distanceToBuyers: 95,
      },
      financial: {
        expectedRecoveryValue: 100,
        warehouseCostAvoided: 50,
        deliveryCostSaved: 20,
      },
      metadata: {
        source: 'seed',
        syntheticFields: [],
        generatedAt: new Date().toISOString(),
      },
    },
    expectedDecision: 'WAREHOUSE_RETURN',
  },
];

/**
 * Seeds flash deal scenarios into the database.
 * Idempotent: deletes all existing seed scenarios before inserting fresh copies.
 */
export async function seedFlashDeals(): Promise<void> {
  // Delete all existing seed scenarios for idempotent behavior
  await FlashDealSeedScenario.deleteMany({});

  // Insert all 5 seed scenarios
  await FlashDealSeedScenario.insertMany(SEED_SCENARIOS);

  console.log(`🎯 Flash Deal seed scenarios loaded: ${SEED_SCENARIOS.length} scenarios`);
}
