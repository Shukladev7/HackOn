/**
 * Tests for Demand Matching Engine - findCandidates (Task 8.1)
 *
 * Tests the geospatial candidate search using MongoDB 2dsphere index.
 * Covers:
 * - haversineDistance utility
 * - Four demand sources searched in parallel
 * - 2dsphere geospatial query format
 * - Radius constraint enforcement
 * - Deduplication and sorting
 * - Configuration overrides
 *
 * Requirements: 5.1, 5.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { haversineDistance, findCandidates, DemandMatchConfig } from './demandMatching';

// Mock Mongoose models
vi.mock('../models/Customer', () => {
  const mockFind = vi.fn();
  return {
    Customer: {
      find: mockFind,
    },
  };
});

vi.mock('../models/Order', () => {
  const mockFind = vi.fn();
  return {
    Order: {
      find: mockFind,
    },
  };
});

import { Customer } from '../models/Customer';
import { Order } from '../models/Order';

describe('haversineDistance', () => {
  it('should return 0 for the same point', () => {
    const point = { lat: 28.6139, lng: 77.209 };
    const distance = haversineDistance(point, point);
    expect(distance).toBeCloseTo(0, 5);
  });

  it('should calculate distance between Delhi and Mumbai correctly (~1150km)', () => {
    const delhi = { lat: 28.6139, lng: 77.209 };
    const mumbai = { lat: 19.076, lng: 72.8777 };
    const distance = haversineDistance(delhi, mumbai);
    expect(distance).toBeGreaterThan(1100);
    expect(distance).toBeLessThan(1200);
  });

  it('should calculate short distances accurately', () => {
    // Two points approximately 10km apart in Delhi
    const point1 = { lat: 28.6139, lng: 77.209 };
    const point2 = { lat: 28.7041, lng: 77.1025 };
    const distance = haversineDistance(point1, point2);
    expect(distance).toBeGreaterThan(5);
    expect(distance).toBeLessThan(20);
  });

  it('should be symmetric (distance A→B = distance B→A)', () => {
    const a = { lat: 28.6139, lng: 77.209 };
    const b = { lat: 19.076, lng: 72.8777 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 10);
  });
});

describe('findCandidates', () => {
  const packageLocation = { lat: 28.6139, lng: 77.209 };
  const sku = 'SKU-001';
  const productCategory = 'electronics';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockCustomers(overrides?: any[]) {
    const defaults = [
      {
        _id: 'cust-1',
        name: 'Customer 1',
        address: {
          geoLocation: {
            type: 'Point',
            coordinates: [77.21, 28.62], // [lng, lat] - very close
          },
        },
        stats: { totalOrders: 10, returnRate: 0.1, avgOrderValue: 500, rtoCount30d: 0 },
        fraudFlag: { flagged: false },
      },
      {
        _id: 'cust-2',
        name: 'Customer 2',
        address: {
          geoLocation: {
            type: 'Point',
            coordinates: [77.25, 28.65], // [lng, lat] - ~5km away
          },
        },
        stats: { totalOrders: 5, returnRate: 0.2, avgOrderValue: 800, rtoCount30d: 1 },
        fraudFlag: { flagged: false },
      },
    ];
    return overrides || defaults;
  }

  it('should return empty array when no nearby customers found', async () => {
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve([]) });

    const result = await findCandidates(sku, packageLocation, productCategory);
    expect(result).toEqual([]);
  });

  it('should use 2dsphere $nearSphere query with correct GeoJSON format', async () => {
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve([]) });

    await findCandidates(sku, packageLocation, productCategory);

    const findCall = (Customer.find as any).mock.calls[0][0];
    expect(findCall['address.geoLocation']).toEqual({
      $nearSphere: {
        $geometry: {
          type: 'Point',
          coordinates: [packageLocation.lng, packageLocation.lat],
        },
        $maxDistance: 50000, // 50km default in meters
      },
    });
  });

  it('should exclude fraud-flagged customers from geospatial query', async () => {
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve([]) });

    await findCandidates(sku, packageLocation, productCategory);

    const findCall = (Customer.find as any).mock.calls[0][0];
    expect(findCall['fraudFlag.flagged']).toEqual({ $ne: true });
  });

  it('should search all four demand sources in parallel', async () => {
    const customers = createMockCustomers();
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });
    (Order.find as any).mockReturnValue({ lean: () => Promise.resolve([]) });

    await findCandidates(sku, packageLocation, productCategory);

    // Customer.find called once for geo query
    expect(Customer.find).toHaveBeenCalledTimes(1);
    // Order.find called 4 times (existing orders, cart, wishlist, predicted intent)
    expect(Order.find).toHaveBeenCalledTimes(4);
  });

  it('should find candidates from existing orders (same SKU)', async () => {
    const customers = createMockCustomers();
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });

    (Order.find as any).mockImplementation((query: any) => {
      if (query.status?.$in?.includes('placed') && query.sku === sku) {
        return {
          lean: () =>
            Promise.resolve([
              { _id: 'order-1', customerId: 'cust-1', sku, status: 'placed' },
            ]),
        };
      }
      return { lean: () => Promise.resolve([]) };
    });

    const result = await findCandidates(sku, packageLocation, productCategory);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const orderCandidate = result.find((c) => c.matchType === 'existing_order');
    expect(orderCandidate).toBeDefined();
    expect(orderCandidate!.buyerId).toBe('cust-1');
    expect(orderCandidate!.matchConfidence).toBe(0.95);
    expect(orderCandidate!.orderId).toBe('order-1');
  });

  it('should find candidates from cart items within recency window', async () => {
    const customers = createMockCustomers();
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });

    (Order.find as any).mockImplementation((query: any) => {
      if (query.status === 'in_cart') {
        return {
          lean: () =>
            Promise.resolve([
              {
                _id: 'cart-1',
                customerId: 'cust-2',
                sku,
                status: 'in_cart',
                updatedAt: new Date(),
              },
            ]),
        };
      }
      return { lean: () => Promise.resolve([]) };
    });

    const result = await findCandidates(sku, packageLocation, productCategory);
    const cartCandidate = result.find((c) => c.matchType === 'cart');
    expect(cartCandidate).toBeDefined();
    expect(cartCandidate!.buyerId).toBe('cust-2');
    expect(cartCandidate!.matchConfidence).toBe(0.85);
    expect(cartCandidate!.cartAddedAt).toBeDefined();
  });

  it('should find candidates from wishlist entries', async () => {
    const customers = createMockCustomers();
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });

    (Order.find as any).mockImplementation((query: any) => {
      if (query.status === 'wishlisted') {
        return {
          lean: () =>
            Promise.resolve([
              { _id: 'wish-1', customerId: 'cust-1', sku, status: 'wishlisted' },
            ]),
        };
      }
      return { lean: () => Promise.resolve([]) };
    });

    const result = await findCandidates(sku, packageLocation, productCategory);
    const wishlistCandidate = result.find((c) => c.matchType === 'wishlist');
    expect(wishlistCandidate).toBeDefined();
    expect(wishlistCandidate!.buyerId).toBe('cust-1');
    expect(wishlistCandidate!.matchConfidence).toBe(0.7);
  });

  it('should find candidates from predicted intent above threshold', async () => {
    const customers = createMockCustomers([
      {
        _id: 'cust-intent',
        name: 'High Intent Customer',
        address: {
          geoLocation: { type: 'Point', coordinates: [77.22, 28.63] },
        },
        stats: { totalOrders: 20, returnRate: 0.05, avgOrderValue: 1200, rtoCount30d: 0 },
        fraudFlag: { flagged: false },
      },
    ]);
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });

    (Order.find as any).mockImplementation((query: any) => {
      if (query.productCategory === productCategory) {
        return {
          lean: () =>
            Promise.resolve([
              { _id: 'o1', customerId: 'cust-intent', productCategory, status: 'delivered' },
              { _id: 'o2', customerId: 'cust-intent', productCategory, status: 'delivered' },
              { _id: 'o3', customerId: 'cust-intent', productCategory, status: 'delivered' },
              { _id: 'o4', customerId: 'cust-intent', productCategory, status: 'delivered' },
            ]),
        };
      }
      return { lean: () => Promise.resolve([]) };
    });

    const result = await findCandidates(sku, packageLocation, productCategory);
    const intentCandidate = result.find((c) => c.matchType === 'predicted_intent');
    expect(intentCandidate).toBeDefined();
    expect(intentCandidate!.intentScore).toBeDefined();
    expect(intentCandidate!.intentScore!).toBeGreaterThanOrEqual(0.6);
  });

  it('should deduplicate candidates preferring higher confidence', async () => {
    const customers = createMockCustomers();
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });

    // Same customer appears in both existing orders and wishlist
    (Order.find as any).mockImplementation((query: any) => {
      if (query.status?.$in?.includes('placed')) {
        return {
          lean: () =>
            Promise.resolve([
              { _id: 'order-1', customerId: 'cust-1', sku, status: 'placed' },
            ]),
        };
      }
      if (query.status === 'wishlisted') {
        return {
          lean: () =>
            Promise.resolve([
              { _id: 'wish-1', customerId: 'cust-1', sku, status: 'wishlisted' },
            ]),
        };
      }
      return { lean: () => Promise.resolve([]) };
    });

    const result = await findCandidates(sku, packageLocation, productCategory);
    const cust1Candidates = result.filter((c) => c.buyerId === 'cust-1');
    expect(cust1Candidates.length).toBe(1);
    expect(cust1Candidates[0].matchType).toBe('existing_order');
    expect(cust1Candidates[0].matchConfidence).toBe(0.95);
  });

  it('should respect custom radius configuration', async () => {
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve([]) });

    const customConfig: Partial<DemandMatchConfig> = { radiusKm: 10 };
    await findCandidates(sku, packageLocation, productCategory, customConfig);

    const findCall = (Customer.find as any).mock.calls[0][0];
    expect(findCall['address.geoLocation'].$nearSphere.$maxDistance).toBe(10000); // 10km in meters
  });

  it('should filter candidates that exceed the configured radius', async () => {
    // Customer far away (the haversine distance will exceed the radius)
    const customers = [
      {
        _id: 'cust-far',
        address: {
          geoLocation: { type: 'Point', coordinates: [78.5, 29.5] }, // ~150km away
        },
        stats: { totalOrders: 5, returnRate: 0.1 },
        fraudFlag: { flagged: false },
      },
    ];
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });

    (Order.find as any).mockImplementation((query: any) => {
      if (query.status === 'wishlisted') {
        return {
          lean: () =>
            Promise.resolve([
              { _id: 'w1', customerId: 'cust-far', sku, status: 'wishlisted' },
            ]),
        };
      }
      return { lean: () => Promise.resolve([]) };
    });

    // Use a small radius - candidate should be filtered out
    const result = await findCandidates(sku, packageLocation, productCategory, { radiusKm: 10 });
    expect(result.length).toBe(0);
  });

  it('should sort results by distance (closest first)', async () => {
    const customers = [
      {
        _id: 'far',
        address: { geoLocation: { type: 'Point', coordinates: [77.4, 28.8] } },
        stats: { totalOrders: 5, returnRate: 0.1 },
        fraudFlag: { flagged: false },
      },
      {
        _id: 'close',
        address: { geoLocation: { type: 'Point', coordinates: [77.21, 28.615] } },
        stats: { totalOrders: 5, returnRate: 0.1 },
        fraudFlag: { flagged: false },
      },
    ];
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });

    (Order.find as any).mockImplementation((query: any) => {
      if (query.status === 'wishlisted') {
        return {
          lean: () =>
            Promise.resolve([
              { _id: 'w1', customerId: 'far', sku, status: 'wishlisted' },
              { _id: 'w2', customerId: 'close', sku, status: 'wishlisted' },
            ]),
        };
      }
      return { lean: () => Promise.resolve([]) };
    });

    const result = await findCandidates(sku, packageLocation, productCategory);
    expect(result.length).toBe(2);
    expect(result[0].buyerId).toBe('close');
    expect(result[1].buyerId).toBe('far');
    expect(result[0].distanceKm).toBeLessThan(result[1].distanceKm);
  });

  it('should enforce cart recency in the query with updatedAt filter', async () => {
    const customers = createMockCustomers();
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });
    (Order.find as any).mockReturnValue({ lean: () => Promise.resolve([]) });

    await findCandidates(sku, packageLocation, productCategory);

    // Find the cart items query (status === 'in_cart')
    const orderCalls = (Order.find as any).mock.calls;
    const cartCall = orderCalls.find((call: any[]) => call[0]?.status === 'in_cart');
    expect(cartCall).toBeDefined();
    expect(cartCall[0].updatedAt).toBeDefined();
    expect(cartCall[0].updatedAt.$gte).toBeInstanceOf(Date);
  });

  it('should query predicted intent only in matching product category', async () => {
    const customers = createMockCustomers();
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });
    (Order.find as any).mockReturnValue({ lean: () => Promise.resolve([]) });

    await findCandidates(sku, packageLocation, productCategory);

    // Find the predicted intent query (has productCategory field)
    const orderCalls = (Order.find as any).mock.calls;
    const intentCall = orderCalls.find((call: any[]) => call[0]?.productCategory === productCategory);
    expect(intentCall).toBeDefined();
  });

  it('should not return predicted intent candidates below threshold', async () => {
    const customers = createMockCustomers([
      {
        _id: 'cust-low',
        address: {
          geoLocation: { type: 'Point', coordinates: [77.22, 28.63] },
        },
        stats: { totalOrders: 2, returnRate: 0.8 },
        fraudFlag: { flagged: false },
      },
    ]);
    (Customer.find as any).mockReturnValue({ lean: () => Promise.resolve(customers) });

    (Order.find as any).mockImplementation((query: any) => {
      if (query.productCategory === productCategory) {
        // Only 1 order with high return rate → intent score will be low
        return {
          lean: () =>
            Promise.resolve([
              { _id: 'o1', customerId: 'cust-low', productCategory, status: 'delivered' },
            ]),
        };
      }
      return { lean: () => Promise.resolve([]) };
    });

    const result = await findCandidates(sku, packageLocation, productCategory);
    const intentCandidate = result.find((c) => c.matchType === 'predicted_intent');
    // Intent score = (1/5) * (1 - 0.8) = 0.04 — below 0.6 threshold
    expect(intentCandidate).toBeUndefined();
  });
});
