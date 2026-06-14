import mongoose, { Types } from 'mongoose';
import {
  Customer,
  Order,
  Courier,
  DeliveryAttempt,
  RTOEvent,
  HubEvent,
  ReallocationEvent,
  DecisionRecord,
  EventStream,
  EvidenceStore,
} from '../models';
import { seedPassports } from './seedPassports';

// ─── Deterministic Seeding ───────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const rand = seededRandom(42);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => rand() - 0.5);
  return shuffled.slice(0, n);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 2): number {
  return parseFloat((rand() * (max - min) + min).toFixed(decimals));
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(randInt(6, 22), randInt(0, 59), randInt(0, 59));
  return d;
}

function hoursAgo(hours: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  d.setMinutes(randInt(0, 59));
  return d;
}

// ─── Reference Data ──────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Priya', 'Rajesh', 'Anita', 'Vikram', 'Sneha', 'Amit', 'Kavita', 'Suresh',
  'Deepa', 'Arjun', 'Meera', 'Rohit', 'Pooja', 'Arun', 'Nisha', 'Kiran',
  'Sanjay', 'Rani', 'Manoj', 'Lakshmi', 'Rahul', 'Divya', 'Gaurav', 'Sunita',
  'Vivek', 'Rekha', 'Nikhil', 'Anjali', 'Pranav', 'Swati', 'Ravi', 'Geeta',
  'Ashwin', 'Pallavi', 'Varun', 'Shilpa', 'Harsh', 'Tanvi', 'Aditya', 'Shruti',
  'Naveen', 'Archana', 'Sachin', 'Bhavna', 'Yogesh', 'Komal', 'Dinesh', 'Jyoti',
  'Prakash', 'Neha',
];

const LAST_NAMES = [
  'Sharma', 'Kumar', 'Verma', 'Patel', 'Singh', 'Reddy', 'Gupta', 'Nair',
  'Joshi', 'Mehta', 'Iyer', 'Choudhary', 'Mishra', 'Bhat', 'Rao', 'Desai',
  'Pillai', 'Malhotra', 'Banerjee', 'Kulkarni',
];

interface CityData {
  city: string;
  state: string;
  pincodePrefix: string;
  lat: number;
  lng: number;
}

const CITIES: CityData[] = [
  { city: 'Mumbai', state: 'Maharashtra', pincodePrefix: '4000', lat: 19.076, lng: 72.877 },
  { city: 'Delhi', state: 'Delhi', pincodePrefix: '1100', lat: 28.613, lng: 77.209 },
  { city: 'Bangalore', state: 'Karnataka', pincodePrefix: '5600', lat: 12.971, lng: 77.594 },
  { city: 'Hyderabad', state: 'Telangana', pincodePrefix: '5000', lat: 17.385, lng: 78.486 },
  { city: 'Pune', state: 'Maharashtra', pincodePrefix: '4110', lat: 18.520, lng: 73.856 },
  { city: 'Chennai', state: 'Tamil Nadu', pincodePrefix: '6000', lat: 13.082, lng: 80.270 },
  { city: 'Kolkata', state: 'West Bengal', pincodePrefix: '7000', lat: 22.572, lng: 88.363 },
  { city: 'Jaipur', state: 'Rajasthan', pincodePrefix: '3020', lat: 26.912, lng: 75.787 },
];

const CATEGORIES = ['electronics', 'clothing', 'home', 'beauty', 'sports', 'books', 'food'];

const HSN_CODES: Record<string, string> = {
  electronics: '8471',
  clothing: '6109',
  home: '9403',
  beauty: '3304',
  sports: '9506',
  books: '4901',
  food: '2106',
};

const PRICE_TIERS: { tier: 'low' | 'medium' | 'high' | 'premium'; min: number; max: number }[] = [
  { tier: 'low', min: 100, max: 500 },
  { tier: 'medium', min: 500, max: 2000 },
  { tier: 'high', min: 2000, max: 10000 },
  { tier: 'premium', min: 10000, max: 50000 },
];

const FAILURE_REASONS = [
  'customer_not_available',
  'wrong_address',
  'refused_delivery',
  'gate_locked',
  'phone_unreachable',
  'address_incomplete',
  'customer_rescheduled',
];

const STATUS_CODES = ['DEL_FAIL', 'CUST_NA', 'ADDR_ERR', 'REF_DEL', 'NO_ACCESS'];

const HUB_EVENT_TYPES = [
  'package_received',
  'quality_check',
  'package_scanned',
  'condition_verified',
  'photo_captured',
  'weight_measured',
  'label_printed',
  'sorted_for_rto',
  'loaded_on_vehicle',
  'dispatched',
];

const COURIER_PARTNERS = ['BlueDart', 'Delhivery', 'DTDC', 'Ecom Express', 'Shadowfax'];

const ROOT_CAUSES = [
  { category: 'customer_issue', subCauses: ['unavailable', 'refused', 'wrong_address', 'rescheduled'] },
  { category: 'courier_issue', subCauses: ['fake_delivery', 'gps_anomaly', 'late_attempt', 'damaged_in_transit'] },
  { category: 'system_issue', subCauses: ['address_mapping_error', 'pincode_mismatch', 'slot_assignment_error'] },
];

const ACTIONS: ('redeliver' | 'reallocate' | 'warehouse_return')[] = ['redeliver', 'reallocate', 'warehouse_return'];

// ─── ID Generation ───────────────────────────────────────────────────────────

function generateObjectIds(count: number): Types.ObjectId[] {
  const ids: Types.ObjectId[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(new Types.ObjectId());
  }
  return ids;
}

// ─── Seed Functions ──────────────────────────────────────────────────────────

function generateCustomers(ids: Types.ObjectId[]) {
  return ids.map((id, i) => {
    const city = CITIES[i % CITIES.length]!;
    const firstName = FIRST_NAMES[i]!;
    const lastName = LAST_NAMES[i % LAST_NAMES.length]!;
    const name = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@email.com`;
    const phone = `+919${randInt(100000000, 999999999)}`;
    const pincode = `${city.pincodePrefix}${String(randInt(10, 99)).padStart(2, '0')}`;

    return {
      _id: id,
      name,
      email,
      phone,
      address: {
        line1: `${randInt(1, 500)}, ${pick(['MG Road', 'Park Street', 'Ring Road', 'Station Road', 'Main Street', 'Lake View Road', 'Gandhi Nagar', 'Nehru Place'])}`,
        line2: pick(['Apt 3B', 'Floor 2', 'Near Market', 'Sector 5', '', '', '']),
        city: city.city,
        state: city.state,
        pincode,
        geoLocation: {
          type: 'Point' as const,
          coordinates: [
            city.lng + randFloat(-0.05, 0.05, 4),
            city.lat + randFloat(-0.05, 0.05, 4),
          ] as [number, number],
        },
      },
      deliveryPreferences: {
        preferredTimeSlot: pick(['morning', 'afternoon', 'evening', '']),
        alternatePhone: rand() > 0.5 ? `+919${randInt(100000000, 999999999)}` : undefined,
        landmarkNotes: pick(['Near temple', 'Opposite mall', 'Behind park', 'Next to school', '']),
      },
      stats: {
        totalOrders: randInt(5, 100),
        returnRate: randFloat(0.01, 0.3),
        avgOrderValue: randFloat(500, 5000),
        rtoCount30d: randInt(0, 5),
      },
      fraudFlag: {
        flagged: i === 48 || i === 49, // Last 2 customers flagged for fraud
        flaggedAt: i >= 48 ? daysAgo(3) : undefined,
        reason: i >= 48 ? 'Excessive RTO requests in 30 days' : undefined,
      },
      createdAt: daysAgo(randInt(30, 180)),
      updatedAt: daysAgo(randInt(0, 7)),
    };
  });
}

function generateCouriers(ids: Types.ObjectId[]) {
  const courierNames = [
    'Raju Yadav', 'Sunil Paswan', 'Mohan Das', 'Akash Tiwari', 'Imran Khan',
    'Deepak Chauhan', 'Santosh Jha', 'Vikas Rawat', 'Ramesh Sahu', 'Ajay Bind',
    'Govind Prasad', 'Lalit Mandal', 'Shankar Mahto', 'Bablu Singh', 'Firoz Ahmed',
    'Kamal Nath', 'Pappu Kumar', 'Sonu Gupta', 'Tinku Sharma', 'Brijesh Pandey',
  ];

  return ids.map((id, i) => ({
    _id: id,
    name: courierNames[i]!,
    partnerId: `${pick(COURIER_PARTNERS)}-${String(randInt(1000, 9999))}`,
    region: pick(CITIES).city,
    rtoCount7d: randInt(0, 12),
    fraudFlag: {
      flagged: i === 2 || i === 7, // 2 couriers flagged
      flaggedAt: (i === 2 || i === 7) ? daysAgo(2) : undefined,
      reason: i === 2 ? 'GPS anomaly pattern detected' : i === 7 ? 'Fake delivery attempts' : undefined,
    },
    createdAt: daysAgo(randInt(60, 365)),
    updatedAt: daysAgo(randInt(0, 7)),
  }));
}

function generateOrders(ids: Types.ObjectId[], customerIds: Types.ObjectId[]) {
  return ids.map((id, i) => {
    const category = pick(CATEGORIES);
    const priceTier = pick(PRICE_TIERS);
    const price = randInt(priceTier.min, priceTier.max);

    return {
      _id: id,
      customerId: customerIds[i % customerIds.length]!,
      sku: `SKU-${category.substring(0, 3).toUpperCase()}-${randInt(10000, 99999)}`,
      productCategory: category,
      price,
      priceTier: priceTier.tier,
      hsnCode: HSN_CODES[category]!,
      status: pick(['placed', 'shipped', 'delivered', 'rto_initiated', 'rto_completed', 'reallocated']),
      placedAt: daysAgo(randInt(1, 14)),
      createdAt: daysAgo(randInt(1, 14)),
      updatedAt: daysAgo(randInt(0, 3)),
    };
  });
}

function generateDeliveryAttempts(
  ids: Types.ObjectId[],
  orderIds: Types.ObjectId[],
  courierIds: Types.ObjectId[],
  customerData: ReturnType<typeof generateCustomers>
) {
  return ids.map((id, i) => {
    const orderIdx = i % orderIds.length;
    const customerIdx = orderIdx % customerData.length;
    const customer = customerData[customerIdx]!;
    const coords = customer.address.geoLocation.coordinates;

    return {
      _id: id,
      orderId: orderIds[orderIdx]!,
      courierId: courierIds[i % courierIds.length]!,
      attemptNumber: (i % 3) + 1,
      gpsLocation: {
        type: 'Point' as const,
        coordinates: [
          coords[0] + randFloat(-0.01, 0.01, 5),
          coords[1] + randFloat(-0.01, 0.01, 5),
        ] as [number, number],
      },
      statusCode: pick(STATUS_CODES),
      failureReason: pick(FAILURE_REASONS),
      attemptedAt: daysAgo(randInt(0, 6)),
      createdAt: daysAgo(randInt(0, 6)),
      updatedAt: daysAgo(randInt(0, 3)),
    };
  });
}

function generateRTOEvents(
  ids: Types.ObjectId[],
  deliveryAttemptIds: Types.ObjectId[],
  orderIds: Types.ObjectId[],
  customerIds: Types.ObjectId[],
  courierIds: Types.ObjectId[],
  customerData: ReturnType<typeof generateCustomers>
) {
  return ids.map((id, i) => {
    const customerIdx = i % customerData.length;
    const customer = customerData[customerIdx]!;
    const rootCause = pick(ROOT_CAUSES);
    const subCause = pick(rootCause.subCauses);
    const category = pick(CATEGORIES);
    const priceTier = pick(PRICE_TIERS);
    const price = randInt(priceTier.min, priceTier.max);
    const recoveryProb = randFloat(0.1, 0.9);
    const candidateCount = randInt(0, 8);
    const topBuyerScore = candidateCount > 0 ? randFloat(0.3, 0.95) : null;

    // Determine action based on recovery probability
    let action: 'redeliver' | 'reallocate' | 'warehouse_return';
    if (recoveryProb > 0.6) {
      action = 'redeliver';
    } else if (candidateCount > 0 && topBuyerScore && topBuyerScore > 0.4) {
      action = 'reallocate';
    } else {
      action = 'warehouse_return';
    }

    const customerScore = rootCause.category === 'customer_issue' ? randFloat(0.6, 0.95) : randFloat(0.05, 0.3);
    const courierScore = rootCause.category === 'courier_issue' ? randFloat(0.6, 0.95) : randFloat(0.05, 0.3);
    const systemScore = rootCause.category === 'system_issue' ? randFloat(0.6, 0.95) : randFloat(0.05, 0.3);

    const status: 'received' | 'eligible' | 'ineligible' | 'classified' | 'decided' | 'executed' =
      pick(['classified', 'decided', 'executed', 'decided', 'executed']);

    return {
      _id: id,
      deliveryAttemptId: deliveryAttemptIds[i % deliveryAttemptIds.length]!,
      shipmentId: `SHP${String(100000 + i).padStart(8, '0')}`,
      orderId: orderIds[i % orderIds.length]!,
      customerId: customerIds[customerIdx]!,
      courierId: courierIds[i % courierIds.length]!,
      packageDetails: {
        sku: `SKU-${category.substring(0, 3).toUpperCase()}-${randInt(10000, 99999)}`,
        weight: randFloat(0.1, 15, 1),
        dimensions: { l: randInt(5, 60), w: randInt(5, 40), h: randInt(2, 30) },
        category,
        price,
        hsnCode: HSN_CODES[category]!,
      },
      hubLocation: {
        type: 'Point' as const,
        coordinates: [
          customer.address.geoLocation.coordinates[0] + randFloat(-0.02, 0.02, 4),
          customer.address.geoLocation.coordinates[1] + randFloat(-0.02, 0.02, 4),
        ] as [number, number],
        hubId: `HUB-${customer.address.city.substring(0, 3).toUpperCase()}-${randInt(1, 5)}`,
      },
      eligibility: {
        eligible: true,
        conditions: {
          unopened: { pass: true, evidenceIds: [`ev-${id}-1`] },
          undamaged: { pass: true, evidenceIds: [`ev-${id}-2`] },
          sealed: { pass: true, evidenceIds: [`ev-${id}-3`] },
        },
        determinedAt: daysAgo(randInt(0, 5)),
      },
      classification: {
        customerScore,
        courierScore,
        systemScore,
        primaryCategory: rootCause.category,
        subCause,
        subCauseConfidence: randFloat(0.6, 0.98),
        requiresManualReview: rand() > 0.8,
        classifiedAt: daysAgo(randInt(0, 5)),
      },
      recoveryPrediction: {
        probability: recoveryProb,
        partiallyImputed: rand() > 0.7,
        imputedFeatures: rand() > 0.7 ? ['delivery_time_preference'] : [],
        predictedAt: daysAgo(randInt(0, 5)),
      },
      decision: {
        action,
        reasoning: getDecisionReasoning(action, recoveryProb, candidateCount),
        inputs: {
          recoveryProbability: recoveryProb,
          candidateBuyerCount: candidateCount,
          topBuyerScore,
        },
        selectedBuyerId: action === 'reallocate' ? customerIds[randInt(0, customerIds.length - 1)] : undefined,
        decidedAt: daysAgo(randInt(0, 4)),
      },
      receivedAt: daysAgo(randInt(1, 6)),
      processedAt: daysAgo(randInt(0, 5)),
      status,
      createdAt: daysAgo(randInt(1, 6)),
      updatedAt: daysAgo(randInt(0, 3)),
    };
  });
}

function getDecisionReasoning(action: string, recovery: number, candidates: number): string {
  switch (action) {
    case 'redeliver':
      return `High recovery probability (${(recovery * 100).toFixed(0)}%) indicates successful redelivery likely. Customer engagement signals positive.`;
    case 'reallocate':
      return `Low recovery probability with ${candidates} candidate buyers in vicinity. Reallocation optimizes inventory recovery and reduces reverse logistics.`;
    case 'warehouse_return':
      return `Recovery probability too low (${(recovery * 100).toFixed(0)}%) and insufficient buyer demand. Returning to warehouse for restocking.`;
    default:
      return 'Decision based on pipeline analysis.';
  }
}

function generateHubEvents(
  count: number,
  rtoEventIds: Types.ObjectId[],
  rtoEvents: ReturnType<typeof generateRTOEvents>
) {
  const events: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    const rtoIdx = i % rtoEventIds.length;
    const rto = rtoEvents[rtoIdx]!;
    events.push({
      _id: new Types.ObjectId(),
      rtoEventId: rtoEventIds[rtoIdx]!,
      hubId: rto.hubLocation.hubId,
      eventType: HUB_EVENT_TYPES[i % HUB_EVENT_TYPES.length]!,
      scanData: {
        scannedBy: `OP-${randInt(100, 999)}`,
        weight: randFloat(0.1, 15, 1),
        condition: pick(['good', 'good', 'good', 'minor_damage', 'sealed']),
      },
      occurredAt: daysAgo(randInt(0, 6)),
      createdAt: daysAgo(randInt(0, 6)),
      updatedAt: daysAgo(randInt(0, 3)),
    });
  }
  return events;
}

function generateReallocationEvents(
  ids: Types.ObjectId[],
  rtoEventIds: Types.ObjectId[],
  orderIds: Types.ObjectId[],
  customerIds: Types.ObjectId[]
) {
  const statuses: Array<'in_progress' | 'completed' | 'failed' | 'rolled_back'> = [
    'completed', 'completed', 'completed', 'in_progress', 'in_progress',
    'completed', 'completed', 'failed', 'rolled_back', 'completed',
    'completed', 'completed', 'in_progress', 'completed', 'completed',
    'failed', 'completed', 'completed', 'rolled_back', 'completed',
  ];

  return ids.map((id, i) => {
    const status = statuses[i % statuses.length]!;
    const steps = generateReallocationSteps(status);

    return {
      _id: id,
      rtoEventId: rtoEventIds[i % rtoEventIds.length]!,
      originalOrderId: orderIds[i % orderIds.length]!,
      newOrderId: status === 'completed' ? orderIds[(i + 60) % orderIds.length] : undefined,
      buyerId: customerIds[randInt(0, customerIds.length - 1)]!,
      status,
      steps,
      gstCreditNote: status === 'completed' ? {
        noteId: `CN-${randInt(100000, 999999)}`,
        generatedAt: daysAgo(randInt(0, 3)),
      } : undefined,
      gstInvoice: status === 'completed' ? {
        invoiceId: `INV-${randInt(100000, 999999)}`,
        generatedAt: daysAgo(randInt(0, 3)),
      } : undefined,
      createdAt: daysAgo(randInt(0, 5)),
      completedAt: status === 'completed' ? daysAgo(randInt(0, 3)) : undefined,
    };
  });
}

function generateReallocationSteps(status: string) {
  const allSteps: Array<'order_creation' | 'label_generation' | 'buyer_notification' | 'original_customer_notification'> = [
    'order_creation',
    'label_generation',
    'buyer_notification',
    'original_customer_notification',
  ];

  if (status === 'completed') {
    return allSteps.map((step) => ({
      step,
      status: 'completed' as const,
      completedAt: daysAgo(randInt(0, 3)),
    }));
  }

  if (status === 'in_progress') {
    return allSteps.map((step, idx) => ({
      step,
      status: idx < 2 ? 'completed' as const : 'pending' as const,
      completedAt: idx < 2 ? daysAgo(randInt(0, 3)) : undefined,
    }));
  }

  if (status === 'failed') {
    return allSteps.map((step, idx) => ({
      step,
      status: idx === 0 ? 'completed' as const : idx === 1 ? 'failed' as const : 'pending' as const,
      completedAt: idx === 0 ? daysAgo(randInt(0, 3)) : undefined,
      error: idx === 1 ? 'Label generation service timeout' : undefined,
    }));
  }

  // rolled_back
  return allSteps.map((step, idx) => ({
    step,
    status: idx < 3 ? 'rolled_back' as const : 'rolled_back' as const,
    completedAt: daysAgo(randInt(0, 3)),
    error: idx === 2 ? 'Buyer declined notification' : undefined,
  }));
}

function generateDecisionRecords(
  count: number,
  rtoEventIds: Types.ObjectId[],
  customerIds: Types.ObjectId[]
) {
  const records: Array<Record<string, unknown>> = [];
  // Distribution: ~35% redeliver, ~40% reallocate, ~25% warehouse_return
  const actionDist: ('redeliver' | 'reallocate' | 'warehouse_return')[] = [];
  for (let i = 0; i < count; i++) {
    const r = i / count;
    if (r < 0.35) actionDist.push('redeliver');
    else if (r < 0.75) actionDist.push('reallocate');
    else actionDist.push('warehouse_return');
  }

  for (let i = 0; i < count; i++) {
    const rootCause = pick(ROOT_CAUSES);
    const subCause = pick(rootCause.subCauses);
    const action = actionDist[i]!;
    const recoveryProb = action === 'redeliver' ? randFloat(0.5, 0.9) :
      action === 'reallocate' ? randFloat(0.1, 0.5) : randFloat(0.05, 0.3);
    const candidateCount = action === 'reallocate' ? randInt(2, 8) : randInt(0, 3);
    const topBuyerScore = action === 'reallocate' ? randFloat(0.5, 0.95) : candidateCount > 0 ? randFloat(0.2, 0.5) : null;

    const customerScore = rootCause.category === 'customer_issue' ? randFloat(0.6, 0.95) : randFloat(0.05, 0.3);
    const courierScore = rootCause.category === 'courier_issue' ? randFloat(0.6, 0.95) : randFloat(0.05, 0.3);
    const systemScore = rootCause.category === 'system_issue' ? randFloat(0.6, 0.95) : randFloat(0.05, 0.3);

    records.push({
      _id: new Types.ObjectId(),
      rtoEventId: rtoEventIds[i % rtoEventIds.length]!,
      rootCause: {
        category: rootCause.category,
        subCause,
        scores: { customer: customerScore, courier: courierScore, system: systemScore },
      },
      action,
      reasoning: getDecisionReasoning(action, recoveryProb, candidateCount),
      inputs: {
        recoveryProbability: recoveryProb,
        candidateBuyerCount: candidateCount,
        topBuyerScore,
      },
      selectedBuyerId: action === 'reallocate' ? customerIds[randInt(0, customerIds.length - 1)] : undefined,
      decidedAt: daysAgo(randInt(0, 6)),
      createdAt: daysAgo(randInt(0, 6)),
      updatedAt: daysAgo(randInt(0, 3)),
    });
  }
  return records;
}

function generateEventStream(
  count: number,
  rtoEventIds: Types.ObjectId[]
) {
  const eventTypes = [
    'eligibility_check', 'classification', 'prediction',
    'demand_match', 'ranking', 'decision', 'reallocation',
  ];
  const actorModules = [
    'evidence_collection', 'root_cause_classifier', 'sale_recovery_predictor',
    'demand_matching', 'buyer_ranking', 'decision_engine',
  ];

  const events: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    const rtoId = rtoEventIds[i % rtoEventIds.length]!;
    const eventTypeIdx = i % eventTypes.length;
    events.push({
      _id: new Types.ObjectId(),
      eventType: eventTypes[eventTypeIdx]!,
      sourceEntityId: rtoId.toString(),
      targetEntityId: rtoId.toString(),
      actorModule: actorModules[Math.min(eventTypeIdx, actorModules.length - 1)]!,
      outcomeStatus: pick(['success', 'success', 'success', 'partial', 'failure']),
      inputParams: { triggeredBy: 'pipeline', step: eventTypeIdx + 1 },
      timestamp: daysAgo(randInt(0, 6)),
      buffered: rand() > 0.8,
      retryCount: rand() > 0.9 ? randInt(1, 3) : 0,
      createdAt: daysAgo(randInt(0, 6)),
      updatedAt: daysAgo(randInt(0, 3)),
    });
  }
  return events;
}

function generateEvidenceStore(
  count: number,
  rtoEventIds: Types.ObjectId[]
) {
  const sourceTypes: Array<'gps' | 'call_logs' | 'delivery_scans' | 'order_history' | 'support_tickets' | 'address_validation' | 'hub_events'> = [
    'gps', 'call_logs', 'delivery_scans', 'order_history',
    'support_tickets', 'address_validation', 'hub_events',
  ];

  const evidence: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    const sourceType = sourceTypes[i % sourceTypes.length]!;
    const collectedAt = daysAgo(randInt(0, 6));
    const expiresAt = new Date(collectedAt);
    expiresAt.setDate(expiresAt.getDate() + 90);

    evidence.push({
      _id: new Types.ObjectId(),
      rtoEventId: rtoEventIds[i % rtoEventIds.length]!,
      sourceType,
      rawData: generateEvidenceData(sourceType),
      sourceId: `SRC-${sourceType.toUpperCase()}-${randInt(10000, 99999)}`,
      collectedAt,
      expiresAt,
      createdAt: collectedAt,
      updatedAt: collectedAt,
    });
  }
  return evidence;
}

function generateEvidenceData(sourceType: string): Record<string, unknown> {
  switch (sourceType) {
    case 'gps':
      return {
        latitude: randFloat(12, 28, 4),
        longitude: randFloat(72, 88, 4),
        accuracy: randFloat(3, 50, 1),
        timestamp: daysAgo(randInt(0, 5)).toISOString(),
        distanceFromAddress: randFloat(0.01, 2, 3),
      };
    case 'call_logs':
      return {
        callAttempts: randInt(1, 5),
        lastCallDuration: randInt(0, 120),
        customerReachable: rand() > 0.4,
        lastAttemptAt: daysAgo(randInt(0, 3)).toISOString(),
      };
    case 'delivery_scans':
      return {
        scanCount: randInt(1, 4),
        lastScanLocation: pick(['hub', 'in_transit', 'at_door', 'returned']),
        conditionAtScan: pick(['good', 'sealed', 'minor_wear']),
      };
    case 'order_history':
      return {
        previousOrders: randInt(1, 50),
        previousRTOs: randInt(0, 5),
        avgDeliveryRating: randFloat(3, 5, 1),
        accountAge: randInt(30, 1000),
      };
    case 'support_tickets':
      return {
        openTickets: randInt(0, 2),
        lastTicketReason: pick(['delivery_delay', 'wrong_item', 'not_received', 'damaged']),
        resolutionRate: randFloat(0.7, 1.0),
      };
    case 'address_validation':
      return {
        addressMatch: rand() > 0.2,
        pincodeValid: true,
        geocodeConfidence: randFloat(0.7, 0.99),
        buildingExists: rand() > 0.1,
      };
    case 'hub_events':
      return {
        lastHubScan: daysAgo(randInt(0, 3)).toISOString(),
        packageCondition: pick(['sealed', 'intact', 'unopened']),
        qualityScore: randFloat(0.8, 1.0),
      };
    default:
      return {};
  }
}

// ─── Main Seed Function ──────────────────────────────────────────────────────

export async function clearAllCollections(): Promise<void> {
  await Promise.all([
    Customer.deleteMany({}),
    Order.deleteMany({}),
    Courier.deleteMany({}),
    DeliveryAttempt.deleteMany({}),
    RTOEvent.deleteMany({}),
    HubEvent.deleteMany({}),
    ReallocationEvent.deleteMany({}),
    DecisionRecord.deleteMany({}),
    EventStream.deleteMany({}),
    EvidenceStore.deleteMany({}),
  ]);
}

export async function seedDemoData(): Promise<{
  customers: number;
  couriers: number;
  orders: number;
  deliveryAttempts: number;
  rtoEvents: number;
  hubEvents: number;
  reallocationEvents: number;
  decisionRecords: number;
  eventStream: number;
  evidence: number;
  passports: number;
}> {
  // Clear existing data first (idempotent)
  await clearAllCollections();

  // Generate IDs
  const customerIds = generateObjectIds(50);
  const courierIds = generateObjectIds(20);
  const orderIds = generateObjectIds(120);
  const deliveryAttemptIds = generateObjectIds(180);
  const rtoEventIds = generateObjectIds(50);
  const reallocationEventIds = generateObjectIds(20);

  // Generate data
  const customers = generateCustomers(customerIds);
  const couriers = generateCouriers(courierIds);
  const orders = generateOrders(orderIds, customerIds);
  const deliveryAttempts = generateDeliveryAttempts(deliveryAttemptIds, orderIds, courierIds, customers);
  const rtoEvents = generateRTOEvents(rtoEventIds, deliveryAttemptIds, orderIds, customerIds, courierIds, customers);
  const hubEvents = generateHubEvents(110, rtoEventIds, rtoEvents);
  const reallocationEvents = generateReallocationEvents(reallocationEventIds, rtoEventIds, orderIds, customerIds);
  const decisionRecords = generateDecisionRecords(35, rtoEventIds, customerIds);
  const eventStream = generateEventStream(150, rtoEventIds);
  const evidence = generateEvidenceStore(100, rtoEventIds);

  // Insert all data
  await Customer.insertMany(customers);
  await Courier.insertMany(couriers);
  await Order.insertMany(orders);
  await DeliveryAttempt.insertMany(deliveryAttempts);
  await RTOEvent.insertMany(rtoEvents);
  await HubEvent.insertMany(hubEvents);
  await ReallocationEvent.insertMany(reallocationEvents);
  await DecisionRecord.insertMany(decisionRecords);
  await EventStream.insertMany(eventStream);
  await EvidenceStore.insertMany(evidence);

  // Seed Product Passports for Circular Routing Engine
  const passportCount = await seedPassports();

  return {
    customers: customers.length,
    couriers: couriers.length,
    orders: orders.length,
    deliveryAttempts: deliveryAttempts.length,
    rtoEvents: rtoEvents.length,
    hubEvents: hubEvents.length,
    reallocationEvents: reallocationEvents.length,
    decisionRecords: decisionRecords.length,
    eventStream: eventStream.length,
    evidence: evidence.length,
    passports: passportCount,
  };
}
