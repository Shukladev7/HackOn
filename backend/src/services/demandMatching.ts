/**
 * Demand Matching Engine
 *
 * Identifies nearby buyers with demand for the RTO package's product.
 * Implements geospatial candidate search, refusal filtering, and candidate validation.
 *
 * Requirements: 5.1, 5.2, 5.4
 */

import { config } from '../config';
import { Customer, ICustomer } from '../models/Customer';
import { Order } from '../models/Order';

export interface DemandCandidate {
  buyerId: string;
  matchType: 'existing_order' | 'cart' | 'wishlist' | 'predicted_intent';
  matchConfidence: number;
  location: { lat: number; lng: number };
  distanceKm: number;
  orderId?: string;
  intentScore?: number;
  cartAddedAt?: string; // ISO 8601 timestamp when item was added to cart
  lastRefusalCheck: { refused: boolean; category?: string; refusedAt?: string; checkDate: string };
}

export interface DemandMatchConfig {
  radiusKm: number;
  intentThreshold: number;
  refusalLookbackDays: number;
  cartRecencyDays: number;
}

const DEFAULT_CONFIG: DemandMatchConfig = {
  radiusKm: config.searchRadiusKm,
  intentThreshold: config.intentThreshold,
  refusalLookbackDays: config.refusalLookbackDays,
  cartRecencyDays: config.cartRecencyDays,
};

/**
 * Filters out candidates who refused delivery of the same product category
 * within the configured lookback period (default: 90 days).
 *
 * Also validates:
 * - Cart recency: cart items must be added within the configured window (default: 7 days)
 * - Intent score: predicted_intent candidates must exceed the configured threshold (default: 0.6)
 *
 * Requirement 5.4: Exclude candidates who refused same product category within 90 days
 * Requirement 5.2: Cart items added within 7 days; intent score above threshold
 */
export function filterRefusals(
  candidates: DemandCandidate[],
  productCategory: string,
  matchConfig?: Partial<DemandMatchConfig>
): DemandCandidate[] {
  const cfg = { ...DEFAULT_CONFIG, ...matchConfig };
  const now = new Date();

  return candidates.filter((candidate) => {
    // Requirement 5.4: Exclude candidates who refused same product category within lookback period
    if (candidate.lastRefusalCheck.refused) {
      const refusalCategory = candidate.lastRefusalCheck.category;
      if (refusalCategory === productCategory) {
        const refusedAt = candidate.lastRefusalCheck.refusedAt
          ? new Date(candidate.lastRefusalCheck.refusedAt)
          : new Date(candidate.lastRefusalCheck.checkDate);

        const daysSinceRefusal = (now.getTime() - refusedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceRefusal <= cfg.refusalLookbackDays) {
          return false;
        }
      }
    }

    // Requirement 5.2: Validate cart recency (7-day window)
    if (candidate.matchType === 'cart') {
      if (!candidate.cartAddedAt) {
        return false; // No cart timestamp means we can't validate recency
      }
      const cartAddedDate = new Date(candidate.cartAddedAt);
      const daysSinceCartAdd = (now.getTime() - cartAddedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCartAdd > cfg.cartRecencyDays) {
        return false;
      }
    }

    // Requirement 5.2: Validate intent score for predicted_intent candidates
    if (candidate.matchType === 'predicted_intent') {
      if (candidate.intentScore === undefined || candidate.intentScore < cfg.intentThreshold) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Validates a single candidate against cart recency and intent score constraints.
 * Returns true if the candidate passes validation.
 *
 * This is a utility used by both filterRefusals and external callers who need
 * to validate individual candidates.
 */
export function validateCandidate(
  candidate: DemandCandidate,
  matchConfig?: Partial<DemandMatchConfig>
): { valid: boolean; reason?: string } {
  const cfg = { ...DEFAULT_CONFIG, ...matchConfig };
  const now = new Date();

  // Validate cart recency
  if (candidate.matchType === 'cart') {
    if (!candidate.cartAddedAt) {
      return { valid: false, reason: 'Cart item missing addedAt timestamp' };
    }
    const cartAddedDate = new Date(candidate.cartAddedAt);
    const daysSinceCartAdd = (now.getTime() - cartAddedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCartAdd > cfg.cartRecencyDays) {
      return { valid: false, reason: `Cart item added ${daysSinceCartAdd.toFixed(1)} days ago, exceeds ${cfg.cartRecencyDays}-day window` };
    }
  }

  // Validate intent score
  if (candidate.matchType === 'predicted_intent') {
    if (candidate.intentScore === undefined) {
      return { valid: false, reason: 'Predicted intent candidate missing intentScore' };
    }
    if (candidate.intentScore < cfg.intentThreshold) {
      return { valid: false, reason: `Intent score ${candidate.intentScore} below threshold ${cfg.intentThreshold}` };
    }
  }

  return { valid: true };
}

// --- Geospatial Utilities ---

const EARTH_RADIUS_KM = 6371;

/**
 * Calculate the Haversine distance between two geo-coordinates in km.
 */
export function haversineDistance(
  point1: { lat: number; lng: number },
  point2: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(point2.lat - point1.lat);
  const dLng = toRad(point2.lng - point1.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(point1.lat)) *
      Math.cos(toRad(point2.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// --- Private search functions for each demand source ---

/**
 * Find nearby customers using MongoDB 2dsphere $nearSphere query.
 * Returns customers within the specified radius of the package location.
 */
async function findNearbyCustomers(
  packageLocation: { lat: number; lng: number },
  radiusKm: number
): Promise<ICustomer[]> {
  const radiusMeters = radiusKm * 1000;

  const customers = await Customer.find({
    'address.geoLocation': {
      $nearSphere: {
        $geometry: {
          type: 'Point',
          coordinates: [packageLocation.lng, packageLocation.lat],
        },
        $maxDistance: radiusMeters,
      },
    },
    'fraudFlag.flagged': { $ne: true },
  }).lean();

  return customers as ICustomer[];
}

/**
 * Search for existing orders with the same SKU from nearby customers.
 * Demand source 1: Existing orders (same SKU, active status)
 */
async function searchExistingOrders(
  sku: string,
  nearbyCustomerIds: string[],
  packageLocation: { lat: number; lng: number },
  customersMap: Map<string, ICustomer>
): Promise<DemandCandidate[]> {
  if (nearbyCustomerIds.length === 0) return [];

  const orders = await Order.find({
    customerId: { $in: nearbyCustomerIds },
    sku: sku,
    status: { $in: ['placed', 'confirmed', 'processing'] },
  }).lean();

  return orders.map((order) => {
    const customer = customersMap.get(order.customerId.toString());
    const coords = customer?.address?.geoLocation?.coordinates || [0, 0];
    const location = { lat: coords[1], lng: coords[0] };
    const distanceKm = haversineDistance(packageLocation, location);

    return {
      buyerId: order.customerId.toString(),
      matchType: 'existing_order' as const,
      matchConfidence: 0.95,
      location,
      distanceKm,
      orderId: (order._id as any)?.toString(),
      lastRefusalCheck: { refused: false, checkDate: new Date().toISOString() },
    };
  });
}

/**
 * Search for cart items (added within recency window) from nearby customers.
 * Demand source 2: Cart items (added within configurable days, default 7)
 */
async function searchCartItems(
  sku: string,
  nearbyCustomerIds: string[],
  packageLocation: { lat: number; lng: number },
  customersMap: Map<string, ICustomer>,
  cartRecencyDays: number
): Promise<DemandCandidate[]> {
  if (nearbyCustomerIds.length === 0) return [];

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - cartRecencyDays);

  const cartItems = await Order.find({
    customerId: { $in: nearbyCustomerIds },
    sku: sku,
    status: 'in_cart',
    updatedAt: { $gte: cutoffDate },
  }).lean();

  return cartItems.map((item) => {
    const customer = customersMap.get(item.customerId.toString());
    const coords = customer?.address?.geoLocation?.coordinates || [0, 0];
    const location = { lat: coords[1], lng: coords[0] };
    const distanceKm = haversineDistance(packageLocation, location);

    return {
      buyerId: item.customerId.toString(),
      matchType: 'cart' as const,
      matchConfidence: 0.85,
      location,
      distanceKm,
      cartAddedAt: (item.updatedAt as Date)?.toISOString?.() || new Date().toISOString(),
      lastRefusalCheck: { refused: false, checkDate: new Date().toISOString() },
    };
  });
}

/**
 * Search for wishlist entries with the same SKU from nearby customers.
 * Demand source 3: Wishlist entries (same SKU)
 */
async function searchWishlistEntries(
  sku: string,
  nearbyCustomerIds: string[],
  packageLocation: { lat: number; lng: number },
  customersMap: Map<string, ICustomer>
): Promise<DemandCandidate[]> {
  if (nearbyCustomerIds.length === 0) return [];

  const wishlistItems = await Order.find({
    customerId: { $in: nearbyCustomerIds },
    sku: sku,
    status: 'wishlisted',
  }).lean();

  return wishlistItems.map((item) => {
    const customer = customersMap.get(item.customerId.toString());
    const coords = customer?.address?.geoLocation?.coordinates || [0, 0];
    const location = { lat: coords[1], lng: coords[0] };
    const distanceKm = haversineDistance(packageLocation, location);

    return {
      buyerId: item.customerId.toString(),
      matchType: 'wishlist' as const,
      matchConfidence: 0.7,
      location,
      distanceKm,
      lastRefusalCheck: { refused: false, checkDate: new Date().toISOString() },
    };
  });
}

/**
 * Search for predicted purchase intent from nearby customers.
 * Demand source 4: Predicted intent (score > configurable threshold, default 0.6)
 *
 * Uses customer order history in the same product category to compute
 * a simple intent score based on order frequency and return rate.
 */
async function searchPredictedIntent(
  productCategory: string,
  nearbyCustomerIds: string[],
  packageLocation: { lat: number; lng: number },
  customersMap: Map<string, ICustomer>,
  intentThreshold: number
): Promise<DemandCandidate[]> {
  if (nearbyCustomerIds.length === 0) return [];

  // Find orders in the same product category for nearby customers
  const orders = await Order.find({
    customerId: { $in: nearbyCustomerIds },
    productCategory: productCategory,
    status: { $in: ['delivered', 'placed', 'confirmed'] },
  }).lean();

  // Group by customer and compute intent score
  const customerOrderCounts = new Map<string, number>();
  for (const order of orders) {
    const custId = order.customerId.toString();
    customerOrderCounts.set(custId, (customerOrderCounts.get(custId) || 0) + 1);
  }

  const candidates: DemandCandidate[] = [];
  for (const [customerId, orderCount] of customerOrderCounts) {
    const customer = customersMap.get(customerId);
    if (!customer) continue;

    // Intent score: higher order count in category + low return rate = higher intent
    const returnRate = customer.stats?.returnRate || 0;
    const intentScore = Math.min(1.0, (orderCount / 5) * (1 - returnRate));

    if (intentScore >= intentThreshold) {
      const coords = customer.address?.geoLocation?.coordinates || [0, 0];
      const location = { lat: coords[1], lng: coords[0] };
      const distanceKm = haversineDistance(packageLocation, location);

      candidates.push({
        buyerId: customerId,
        matchType: 'predicted_intent',
        matchConfidence: intentScore,
        location,
        distanceKm,
        intentScore,
        lastRefusalCheck: { refused: false, checkDate: new Date().toISOString() },
      });
    }
  }

  return candidates;
}

// --- Main exported function ---

/**
 * Find demand candidates for a given SKU near a package location.
 *
 * Uses MongoDB 2dsphere index for radius-based geospatial search,
 * then searches four demand sources in parallel:
 * 1. Existing orders (same SKU, active status)
 * 2. Cart items (added within configurable recency window)
 * 3. Wishlist entries (same SKU)
 * 4. Predicted intent (score > configurable threshold)
 *
 * Must complete within 15 seconds.
 * Requirements: 5.1, 5.2
 */
export async function findCandidates(
  sku: string,
  packageLocation: { lat: number; lng: number },
  productCategory: string,
  matchConfig?: Partial<DemandMatchConfig>
): Promise<DemandCandidate[]> {
  const cfg: DemandMatchConfig = { ...DEFAULT_CONFIG, ...matchConfig };

  // Step 1: Find all nearby customers using 2dsphere index
  const nearbyCustomers = await findNearbyCustomers(packageLocation, cfg.radiusKm);

  if (nearbyCustomers.length === 0) return [];

  // Build lookup map for customer data
  const customersMap = new Map<string, ICustomer>();
  const customerIds: string[] = [];
  for (const customer of nearbyCustomers) {
    const id = (customer._id as any).toString();
    customersMap.set(id, customer);
    customerIds.push(id);
  }

  // Step 2: Search all four demand sources in parallel (Requirement 5.2)
  const [existingOrders, cartItems, wishlistEntries, predictedIntent] = await Promise.all([
    searchExistingOrders(sku, customerIds, packageLocation, customersMap),
    searchCartItems(sku, customerIds, packageLocation, customersMap, cfg.cartRecencyDays),
    searchWishlistEntries(sku, customerIds, packageLocation, customersMap),
    searchPredictedIntent(productCategory, customerIds, packageLocation, customersMap, cfg.intentThreshold),
  ]);

  // Step 3: Merge and deduplicate candidates (prefer higher confidence match type)
  const candidateMap = new Map<string, DemandCandidate>();

  const allCandidates = [
    ...existingOrders,
    ...cartItems,
    ...wishlistEntries,
    ...predictedIntent,
  ];

  for (const candidate of allCandidates) {
    const existing = candidateMap.get(candidate.buyerId);
    if (!existing || candidate.matchConfidence > existing.matchConfidence) {
      candidateMap.set(candidate.buyerId, candidate);
    }
  }

  // Step 4: Filter to only candidates within configured radius (Requirement 5.1)
  const results = Array.from(candidateMap.values()).filter(
    (c) => c.distanceKm <= cfg.radiusKm
  );

  // Sort by distance (closest first)
  results.sort((a, b) => a.distanceKm - b.distanceKm);

  return results;
}
