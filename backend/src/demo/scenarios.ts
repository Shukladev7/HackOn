import { Types } from 'mongoose';

export interface ScenarioStep {
  timestamp: string;
  module: string;
  event: string;
  status: 'success' | 'failure' | 'partial' | 'pending';
  details: string;
}

export interface ScenarioEvidence {
  sourceType: string;
  summary: string;
  confidence: number;
}

export interface ScenarioBuyerCandidate {
  name: string;
  city: string;
  distance: string;
  score: number;
  conversionProbability: number;
}

export interface ScenarioAlert {
  type: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  triggeredAt: string;
}

export interface Scenario {
  id: number;
  title: string;
  description: string;
  rootCause: {
    category: string;
    subCause: string;
    scores: { customer: number; courier: number; system: number };
  };
  recoveryProbability: number;
  decision: {
    action: 'redeliver' | 'reallocate' | 'warehouse_return';
    reasoning: string;
  };
  timeline: ScenarioStep[];
  evidence: ScenarioEvidence[];
  buyerCandidates: ScenarioBuyerCandidate[];
  alerts: ScenarioAlert[];
  outcome: string;
}

export function getScenarios(): Scenario[] {
  return [
    // Scenario 1: Customer unavailable → high recovery → redelivery
    {
      id: 1,
      title: 'Customer Unavailable → Redelivery',
      description: 'Customer was not home during delivery attempt. High recovery probability based on order history and engagement signals.',
      rootCause: {
        category: 'customer_issue',
        subCause: 'unavailable',
        scores: { customer: 0.82, courier: 0.08, system: 0.10 },
      },
      recoveryProbability: 0.78,
      decision: {
        action: 'redeliver',
        reasoning: 'High recovery probability (78%) with customer showing positive engagement. Previous successful deliveries to same address. Recommending redelivery in preferred time slot.',
      },
      timeline: [
        { timestamp: '2025-01-14T09:30:00Z', module: 'Event Ingress', event: 'RTO event received', status: 'success', details: 'Shipment SHP10000001 flagged for RTO' },
        { timestamp: '2025-01-14T09:30:05Z', module: 'Evidence Collection', event: 'Evidence gathered from 5 sources', status: 'success', details: 'GPS, call logs, delivery scans, order history, address validation' },
        { timestamp: '2025-01-14T09:30:08Z', module: 'Eligibility Check', event: 'Package eligible for reallocation', status: 'success', details: 'Unopened, undamaged, sealed - all conditions pass' },
        { timestamp: '2025-01-14T09:30:12Z', module: 'Root Cause Classifier', event: 'Classified as customer_issue/unavailable', status: 'success', details: 'Customer score: 0.82, Confidence: 91%' },
        { timestamp: '2025-01-14T09:30:15Z', module: 'Recovery Predictor', event: 'Recovery probability: 78%', status: 'success', details: 'Based on customer history, time preferences, and engagement' },
        { timestamp: '2025-01-14T09:30:18Z', module: 'Decision Engine', event: 'Decision: REDELIVER', status: 'success', details: 'High recovery probability exceeds threshold (>60%)' },
      ],
      evidence: [
        { sourceType: 'gps', summary: 'Courier reached correct address, waited 8 minutes', confidence: 0.95 },
        { sourceType: 'call_logs', summary: '3 call attempts, no answer. Customer typically available after 6PM', confidence: 0.88 },
        { sourceType: 'order_history', summary: '23 previous orders, 95% delivery success rate', confidence: 0.92 },
        { sourceType: 'delivery_scans', summary: 'Package condition: sealed, undamaged', confidence: 0.99 },
        { sourceType: 'address_validation', summary: 'Address verified, building exists, geocode confidence 98%', confidence: 0.98 },
      ],
      buyerCandidates: [],
      alerts: [],
      outcome: 'Package scheduled for redelivery in customer preferred evening slot (6-9 PM). Customer notified via SMS.',
    },

    // Scenario 2: Wrong address → low recovery → reallocation to nearby buyer
    {
      id: 2,
      title: 'Wrong Address → Reallocation',
      description: 'Delivery address is incorrect/non-existent. Low recovery probability. Strong demand from nearby buyers for same product category.',
      rootCause: {
        category: 'customer_issue',
        subCause: 'wrong_address',
        scores: { customer: 0.75, courier: 0.05, system: 0.20 },
      },
      recoveryProbability: 0.22,
      decision: {
        action: 'reallocate',
        reasoning: 'Low recovery probability (22%) due to invalid address. 5 candidate buyers found within 15km radius with high conversion probability. Top buyer score: 0.87.',
      },
      timeline: [
        { timestamp: '2025-01-13T14:20:00Z', module: 'Event Ingress', event: 'RTO event received', status: 'success', details: 'Shipment SHP10000002 - address not found' },
        { timestamp: '2025-01-13T14:20:05Z', module: 'Evidence Collection', event: 'Evidence gathered from 6 sources', status: 'success', details: 'GPS shows courier at wrong location vs registered address' },
        { timestamp: '2025-01-13T14:20:08Z', module: 'Eligibility Check', event: 'Package eligible for reallocation', status: 'success', details: 'All eligibility conditions pass' },
        { timestamp: '2025-01-13T14:20:12Z', module: 'Root Cause Classifier', event: 'Classified as customer_issue/wrong_address', status: 'success', details: 'Address validation failed, geocode mismatch' },
        { timestamp: '2025-01-13T14:20:15Z', module: 'Recovery Predictor', event: 'Recovery probability: 22%', status: 'success', details: 'Address correction unlikely, customer unresponsive' },
        { timestamp: '2025-01-13T14:20:18Z', module: 'Demand Matching', event: '5 candidate buyers found', status: 'success', details: 'Within 15km radius, matching category: electronics' },
        { timestamp: '2025-01-13T14:20:22Z', module: 'Buyer Ranking', event: 'Top buyer scored 0.87', status: 'success', details: 'Ranked by distance, conversion, speed, margin' },
        { timestamp: '2025-01-13T14:20:25Z', module: 'Decision Engine', event: 'Decision: REALLOCATE', status: 'success', details: 'Strong buyer demand, low recovery. Reallocation maximizes value.' },
      ],
      evidence: [
        { sourceType: 'gps', summary: 'Courier GPS shows location 2.3km from registered address', confidence: 0.94 },
        { sourceType: 'address_validation', summary: 'Address does not exist in postal database. Building not found.', confidence: 0.96 },
        { sourceType: 'call_logs', summary: '5 call attempts over 2 days, customer unreachable', confidence: 0.90 },
        { sourceType: 'order_history', summary: 'First order from this customer, no delivery history', confidence: 0.85 },
        { sourceType: 'support_tickets', summary: 'No address correction request filed', confidence: 0.80 },
      ],
      buyerCandidates: [
        { name: 'Sneha Patel', city: 'Mumbai', distance: '3.2 km', score: 0.87, conversionProbability: 0.82 },
        { name: 'Vikram Mehta', city: 'Mumbai', distance: '5.1 km', score: 0.74, conversionProbability: 0.71 },
        { name: 'Kavita Desai', city: 'Mumbai', distance: '7.8 km', score: 0.68, conversionProbability: 0.65 },
        { name: 'Amit Sharma', city: 'Mumbai', distance: '9.4 km', score: 0.61, conversionProbability: 0.58 },
        { name: 'Deepa Kulkarni', city: 'Mumbai', distance: '12.1 km', score: 0.55, conversionProbability: 0.52 },
      ],
      alerts: [],
      outcome: 'Package reallocated to Sneha Patel (score: 0.87). New order created, shipping label generated, buyer notified.',
    },

    // Scenario 3: Courier fake delivery → escalation alert
    {
      id: 3,
      title: 'Fake Delivery Attempt → Escalation',
      description: 'GPS evidence shows courier never reached delivery address. Pattern of similar behavior detected across 4 deliveries in past 7 days.',
      rootCause: {
        category: 'courier_issue',
        subCause: 'fake_delivery',
        scores: { customer: 0.05, courier: 0.89, system: 0.06 },
      },
      recoveryProbability: 0.85,
      decision: {
        action: 'redeliver',
        reasoning: 'Courier issue confirmed via GPS anomaly. Customer address valid, high recovery on reassignment to different courier. Escalation alert generated for courier review.',
      },
      timeline: [
        { timestamp: '2025-01-14T11:00:00Z', module: 'Event Ingress', event: 'RTO event received', status: 'success', details: 'Delivery marked as failed by courier' },
        { timestamp: '2025-01-14T11:00:05Z', module: 'Evidence Collection', event: 'GPS anomaly detected', status: 'success', details: 'Courier GPS 4.2km from delivery address at time of attempt' },
        { timestamp: '2025-01-14T11:00:08Z', module: 'Eligibility Check', event: 'Package eligible', status: 'success', details: 'Package never left vehicle' },
        { timestamp: '2025-01-14T11:00:12Z', module: 'Root Cause Classifier', event: 'Classified as courier_issue/fake_delivery', status: 'success', details: 'High courier score: 0.89, GPS evidence conclusive' },
        { timestamp: '2025-01-14T11:00:15Z', module: 'Fraud Detection', event: 'Pattern detected: 4 similar events in 7 days', status: 'success', details: 'Courier COU-BD-4521 flagged for review' },
        { timestamp: '2025-01-14T11:00:18Z', module: 'Recovery Predictor', event: 'Recovery probability: 85%', status: 'success', details: 'High recovery with different courier assignment' },
        { timestamp: '2025-01-14T11:00:22Z', module: 'Decision Engine', event: 'Decision: REDELIVER (different courier)', status: 'success', details: 'Reassign to verified courier' },
        { timestamp: '2025-01-14T11:00:25Z', module: 'Courier Escalation', event: 'Escalation alert generated', status: 'success', details: 'Alert sent to operations team' },
      ],
      evidence: [
        { sourceType: 'gps', summary: 'Courier GPS location 4.2km from delivery address at marked delivery time', confidence: 0.97 },
        { sourceType: 'call_logs', summary: 'No call attempt made to customer', confidence: 0.93 },
        { sourceType: 'delivery_scans', summary: 'No doorstep scan recorded, only in-vehicle scan', confidence: 0.95 },
        { sourceType: 'order_history', summary: 'Customer has 95% acceptance rate on deliveries', confidence: 0.90 },
      ],
      buyerCandidates: [],
      alerts: [
        {
          type: 'courier_escalation',
          severity: 'high',
          message: 'Courier COU-BD-4521 (Bablu Singh) has 4 GPS-anomaly events in 7 days. Possible fake delivery pattern. Immediate review required.',
          triggeredAt: '2025-01-14T11:00:25Z',
        },
      ],
      outcome: 'Package reassigned to verified courier. Escalation alert sent to operations. Courier flagged for performance review.',
    },

    // Scenario 4: GPS anomaly → courier performance review
    {
      id: 4,
      title: 'GPS Anomaly → Performance Review',
      description: 'Courier\'s GPS shows erratic movement pattern inconsistent with delivery route. Triggers automated performance review threshold.',
      rootCause: {
        category: 'courier_issue',
        subCause: 'gps_anomaly',
        scores: { customer: 0.10, courier: 0.78, system: 0.12 },
      },
      recoveryProbability: 0.72,
      decision: {
        action: 'redeliver',
        reasoning: 'GPS anomaly suggests route deviation, not intentional fraud. Recovery likely with re-attempt. Performance review triggered for coaching.',
      },
      timeline: [
        { timestamp: '2025-01-12T16:45:00Z', module: 'Event Ingress', event: 'RTO event received', status: 'success', details: 'Delivery attempt timeout - courier off-route' },
        { timestamp: '2025-01-12T16:45:05Z', module: 'Evidence Collection', event: 'GPS trace analyzed', status: 'success', details: '47 waypoints analyzed, route deviation of 3.8km' },
        { timestamp: '2025-01-12T16:45:10Z', module: 'Root Cause Classifier', event: 'Classified as courier_issue/gps_anomaly', status: 'success', details: 'Route efficiency: 34%, expected: >70%' },
        { timestamp: '2025-01-12T16:45:14Z', module: 'Recovery Predictor', event: 'Recovery probability: 72%', status: 'success', details: 'Customer available, address valid' },
        { timestamp: '2025-01-12T16:45:18Z', module: 'Decision Engine', event: 'Decision: REDELIVER', status: 'success', details: 'Re-attempt with route optimization' },
        { timestamp: '2025-01-12T16:45:22Z', module: 'Courier Escalation', event: 'Performance review triggered', status: 'success', details: 'Threshold: 3 anomalies in 7 days. Current: 3.' },
      ],
      evidence: [
        { sourceType: 'gps', summary: 'Route efficiency 34% vs expected 70%+. 3.8km deviation from optimal path.', confidence: 0.91 },
        { sourceType: 'delivery_scans', summary: 'Delivery attempt recorded but GPS inconsistent with location', confidence: 0.87 },
        { sourceType: 'call_logs', summary: 'One call attempt, customer answered but courier did not arrive', confidence: 0.88 },
      ],
      buyerCandidates: [],
      alerts: [
        {
          type: 'performance_review',
          severity: 'medium',
          message: 'Courier COU-DL-7823 (Deepak Chauhan) triggered performance review threshold. 3 GPS anomalies in 7 days. Route optimization coaching recommended.',
          triggeredAt: '2025-01-12T16:45:22Z',
        },
      ],
      outcome: 'Redelivery scheduled with optimized route. Courier flagged for route optimization coaching.',
    },

    // Scenario 5: System address mapping error → technical correction → redelivery
    {
      id: 5,
      title: 'System Error → Technical Fix → Redelivery',
      description: 'Internal address mapping system incorrectly geocoded the delivery address. Technical team corrected the mapping. High confidence redelivery.',
      rootCause: {
        category: 'system_issue',
        subCause: 'address_mapping_error',
        scores: { customer: 0.08, courier: 0.07, system: 0.85 },
      },
      recoveryProbability: 0.91,
      decision: {
        action: 'redeliver',
        reasoning: 'System error identified and corrected. Address mapping fixed. Very high recovery probability (91%) with corrected coordinates. No customer or courier fault.',
      },
      timeline: [
        { timestamp: '2025-01-13T08:15:00Z', module: 'Event Ingress', event: 'RTO event received', status: 'success', details: 'Courier reports address not found at GPS coordinates' },
        { timestamp: '2025-01-13T08:15:05Z', module: 'Evidence Collection', event: 'Address validation reveals mismatch', status: 'success', details: 'Geocode points to empty lot, building exists 200m away' },
        { timestamp: '2025-01-13T08:15:10Z', module: 'Root Cause Classifier', event: 'Classified as system_issue/address_mapping_error', status: 'success', details: 'System score: 0.85, geocode offset detected' },
        { timestamp: '2025-01-13T08:15:14Z', module: 'Technical Correction', event: 'Address mapping updated', status: 'success', details: 'Corrected coordinates: +200m north offset applied' },
        { timestamp: '2025-01-13T08:15:18Z', module: 'Recovery Predictor', event: 'Recovery probability: 91%', status: 'success', details: 'With corrected address, delivery is near-certain' },
        { timestamp: '2025-01-13T08:15:22Z', module: 'Decision Engine', event: 'Decision: REDELIVER', status: 'success', details: 'System error fixed, redelivery with correct coordinates' },
      ],
      evidence: [
        { sourceType: 'address_validation', summary: 'Geocode offset: 200m from actual building. Mapping error confirmed in postal DB.', confidence: 0.97 },
        { sourceType: 'gps', summary: 'Courier reached geocoded location correctly. Building not at coordinates.', confidence: 0.95 },
        { sourceType: 'support_tickets', summary: 'Customer confirmed address is correct, has received deliveries before from other services', confidence: 0.92 },
      ],
      buyerCandidates: [],
      alerts: [],
      outcome: 'Address mapping corrected in system. Redelivery scheduled with updated GPS coordinates. Customer notified of resolution.',
    },

    // Scenario 6: Low recovery + strong nearby demand → reallocation success
    {
      id: 6,
      title: 'Strong Demand → Reallocation Success',
      description: 'Customer has high RTO history (5 RTOs in 30 days). Strong demand from 7 nearby buyers for premium electronics item.',
      rootCause: {
        category: 'customer_issue',
        subCause: 'refused',
        scores: { customer: 0.88, courier: 0.05, system: 0.07 },
      },
      recoveryProbability: 0.15,
      decision: {
        action: 'reallocate',
        reasoning: 'Very low recovery probability (15%) - customer has pattern of refusals (5 RTOs in 30 days). Premium electronics item (₹24,999) has strong demand. 7 candidate buyers, top score 0.92.',
      },
      timeline: [
        { timestamp: '2025-01-14T10:00:00Z', module: 'Event Ingress', event: 'RTO event received', status: 'success', details: 'Customer refused delivery - 5th RTO in 30 days' },
        { timestamp: '2025-01-14T10:00:05Z', module: 'Evidence Collection', event: 'Customer history reveals pattern', status: 'success', details: '5 RTOs in 30 days, fraud flag triggered' },
        { timestamp: '2025-01-14T10:00:08Z', module: 'Eligibility Check', event: 'Package eligible', status: 'success', details: 'Sealed electronics, original packaging intact' },
        { timestamp: '2025-01-14T10:00:12Z', module: 'Root Cause Classifier', event: 'Classified as customer_issue/refused', status: 'success', details: 'Repeat offender pattern, customer score: 0.88' },
        { timestamp: '2025-01-14T10:00:15Z', module: 'Recovery Predictor', event: 'Recovery probability: 15%', status: 'success', details: 'Pattern suggests intentional refusal behavior' },
        { timestamp: '2025-01-14T10:00:18Z', module: 'Demand Matching', event: '7 candidate buyers found', status: 'success', details: 'Premium electronics in high demand, 30km radius' },
        { timestamp: '2025-01-14T10:00:22Z', module: 'Buyer Ranking', event: 'Top buyer scored 0.92', status: 'success', details: 'Active cart with same product, 2.1km away' },
        { timestamp: '2025-01-14T10:00:25Z', module: 'Decision Engine', event: 'Decision: REALLOCATE', status: 'success', details: 'Maximum value recovery through reallocation' },
        { timestamp: '2025-01-14T10:00:30Z', module: 'Reallocation Service', event: 'Reallocation executed successfully', status: 'success', details: 'All 4 steps completed' },
      ],
      evidence: [
        { sourceType: 'order_history', summary: '5 RTOs in 30 days. Customer flagged for potential abuse. Avg order value: ₹15,000+', confidence: 0.96 },
        { sourceType: 'call_logs', summary: 'Customer answered, explicitly refused delivery. No reason provided.', confidence: 0.94 },
        { sourceType: 'delivery_scans', summary: 'Package unopened, factory sealed, condition: perfect', confidence: 0.99 },
      ],
      buyerCandidates: [
        { name: 'Arjun Reddy', city: 'Hyderabad', distance: '2.1 km', score: 0.92, conversionProbability: 0.89 },
        { name: 'Meera Iyer', city: 'Hyderabad', distance: '4.5 km', score: 0.85, conversionProbability: 0.81 },
        { name: 'Rohit Choudhary', city: 'Hyderabad', distance: '6.2 km', score: 0.79, conversionProbability: 0.74 },
        { name: 'Pooja Rao', city: 'Hyderabad', distance: '8.7 km', score: 0.71, conversionProbability: 0.68 },
        { name: 'Kiran Bhat', city: 'Hyderabad', distance: '11.3 km', score: 0.64, conversionProbability: 0.60 },
        { name: 'Sanjay Nair', city: 'Hyderabad', distance: '15.8 km', score: 0.58, conversionProbability: 0.54 },
        { name: 'Nisha Joshi', city: 'Hyderabad', distance: '22.4 km', score: 0.51, conversionProbability: 0.48 },
      ],
      alerts: [
        {
          type: 'fraud_flag',
          severity: 'high',
          message: 'Customer flagged for potential RTO abuse: 5 refusals in 30 days. Account under review.',
          triggeredAt: '2025-01-14T10:00:06Z',
        },
      ],
      outcome: 'Package successfully reallocated to Arjun Reddy. ₹24,999 revenue recovered. GST credit note and new invoice generated.',
    },

    // Scenario 7: Reallocation execution with all 4 steps completed
    {
      id: 7,
      title: 'Full Reallocation Pipeline',
      description: 'Complete reallocation execution demonstrating all 4 steps: order creation, label generation, buyer notification, and original customer notification.',
      rootCause: {
        category: 'customer_issue',
        subCause: 'rescheduled',
        scores: { customer: 0.70, courier: 0.10, system: 0.20 },
      },
      recoveryProbability: 0.28,
      decision: {
        action: 'reallocate',
        reasoning: 'Customer repeatedly rescheduled (3 times). Low recovery probability. Clothing item with strong seasonal demand nearby.',
      },
      timeline: [
        { timestamp: '2025-01-11T13:00:00Z', module: 'Event Ingress', event: 'RTO triggered after 3rd reschedule', status: 'success', details: 'Policy: max 3 reschedules before RTO' },
        { timestamp: '2025-01-11T13:00:10Z', module: 'Pipeline Processing', event: 'Full pipeline analysis complete', status: 'success', details: 'Classification → Prediction → Matching → Ranking' },
        { timestamp: '2025-01-11T13:00:15Z', module: 'Decision Engine', event: 'Decision: REALLOCATE', status: 'success', details: 'Seasonal item, time-sensitive, nearby demand exists' },
        { timestamp: '2025-01-11T13:01:00Z', module: 'Reallocation Step 1', event: 'New order created for buyer', status: 'success', details: 'Order ORD-NEW-78432 created, linked to original' },
        { timestamp: '2025-01-11T13:01:30Z', module: 'Reallocation Step 2', event: 'Shipping label generated', status: 'success', details: 'Label LBL-88291 generated for hub-to-buyer route' },
        { timestamp: '2025-01-11T13:02:00Z', module: 'Reallocation Step 3', event: 'Buyer notified', status: 'success', details: 'SMS + email sent to buyer with delivery ETA' },
        { timestamp: '2025-01-11T13:02:30Z', module: 'Reallocation Step 4', event: 'Original customer notified', status: 'success', details: 'Refund initiated, notification sent' },
        { timestamp: '2025-01-11T13:03:00Z', module: 'GST Service', event: 'GST compliance completed', status: 'success', details: 'Credit note CN-445231, New invoice INV-778892' },
      ],
      evidence: [
        { sourceType: 'order_history', summary: '3 consecutive reschedules. Customer cited "busy schedule" each time.', confidence: 0.90 },
        { sourceType: 'call_logs', summary: 'Customer confirmed they cannot accept delivery this week', confidence: 0.92 },
        { sourceType: 'delivery_scans', summary: 'Package at hub, condition: perfect, sealed', confidence: 0.99 },
      ],
      buyerCandidates: [
        { name: 'Divya Malhotra', city: 'Delhi', distance: '4.8 km', score: 0.84, conversionProbability: 0.79 },
        { name: 'Gaurav Singh', city: 'Delhi', distance: '7.2 km', score: 0.76, conversionProbability: 0.72 },
        { name: 'Sunita Banerjee', city: 'Delhi', distance: '11.5 km', score: 0.68, conversionProbability: 0.63 },
      ],
      alerts: [],
      outcome: 'Full reallocation completed in 3 minutes. All 4 steps successful. GST compliance handled. Package en route to new buyer.',
    },

    // Scenario 8: Reallocation failure → rollback → warehouse return
    {
      id: 8,
      title: 'Reallocation Failure → Warehouse Return',
      description: 'Reallocation attempted but buyer declined at notification step. System rolled back all changes and routed package to warehouse.',
      rootCause: {
        category: 'customer_issue',
        subCause: 'refused',
        scores: { customer: 0.72, courier: 0.08, system: 0.20 },
      },
      recoveryProbability: 0.18,
      decision: {
        action: 'reallocate',
        reasoning: 'Low recovery from original customer. Attempted reallocation to nearby buyer. Buyer declined after notification.',
      },
      timeline: [
        { timestamp: '2025-01-12T09:00:00Z', module: 'Event Ingress', event: 'RTO event received', status: 'success', details: 'Customer refused delivery' },
        { timestamp: '2025-01-12T09:00:10Z', module: 'Pipeline Processing', event: 'Analysis complete', status: 'success', details: 'Low recovery, reallocation recommended' },
        { timestamp: '2025-01-12T09:00:15Z', module: 'Decision Engine', event: 'Decision: REALLOCATE', status: 'success', details: '3 candidate buyers identified' },
        { timestamp: '2025-01-12T09:01:00Z', module: 'Reallocation Step 1', event: 'New order created', status: 'success', details: 'Order created for top-ranked buyer' },
        { timestamp: '2025-01-12T09:01:30Z', module: 'Reallocation Step 2', event: 'Label generated', status: 'success', details: 'Shipping label ready' },
        { timestamp: '2025-01-12T09:02:00Z', module: 'Reallocation Step 3', event: 'Buyer notification - DECLINED', status: 'failure', details: 'Buyer responded: "Changed my mind, don\'t want it"' },
        { timestamp: '2025-01-12T09:02:10Z', module: 'Rollback Service', event: 'Rolling back steps 1-2', status: 'success', details: 'Order cancelled, label voided' },
        { timestamp: '2025-01-12T09:02:20Z', module: 'Decision Engine', event: 'Fallback: WAREHOUSE_RETURN', status: 'success', details: 'No other candidates above threshold. Routing to warehouse.' },
        { timestamp: '2025-01-12T09:02:30Z', module: 'Hub Operations', event: 'Package sorted for warehouse return', status: 'success', details: 'Assigned to return batch RB-2025-0112' },
      ],
      evidence: [
        { sourceType: 'order_history', summary: 'Original customer: first-time buyer, refused without reason', confidence: 0.85 },
        { sourceType: 'delivery_scans', summary: 'Package in perfect condition, eligible for restocking', confidence: 0.99 },
        { sourceType: 'call_logs', summary: 'Buyer candidate called, initially interested, then declined', confidence: 0.95 },
      ],
      buyerCandidates: [
        { name: 'Vivek Gupta', city: 'Pune', distance: '5.3 km', score: 0.72, conversionProbability: 0.68 },
        { name: 'Rekha Mishra', city: 'Pune', distance: '9.1 km', score: 0.58, conversionProbability: 0.53 },
        { name: 'Nikhil Pillai', city: 'Pune', distance: '14.7 km', score: 0.45, conversionProbability: 0.41 },
      ],
      alerts: [
        {
          type: 'reallocation_failed',
          severity: 'medium',
          message: 'Reallocation to Vivek Gupta failed at notification step. Buyer declined. Rollback executed successfully.',
          triggeredAt: '2025-01-12T09:02:10Z',
        },
      ],
      outcome: 'Reallocation rolled back. Package routed to warehouse for restocking. Original customer refund processed.',
    },
  ];
}

export function getScenarioById(id: number): Scenario | undefined {
  return getScenarios().find((s) => s.id === id);
}
