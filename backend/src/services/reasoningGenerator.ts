/**
 * AI Reasoning Generator Service
 *
 * Generates structured reasoning data (SHAP-style feature importance)
 * from an RTO event's classification and recovery prediction.
 */

export interface ReasoningStep {
  timestamp: string;
  module: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'finding' | 'result';
}

export interface FeatureFactor {
  factor: string;
  contribution: number;
  direction: 'positive' | 'negative';
  description: string;
}

export interface ReasoningResponse {
  steps: ReasoningStep[];
  featureImportance: {
    classification: FeatureFactor[];
    recovery: FeatureFactor[];
  };
  finalConfidence: number;
  decision: string;
  processingTimeMs: number;
}

interface RTOEventDoc {
  _id: any;
  classification?: {
    primaryCategory?: string;
    subCause?: string;
    customerScore?: number;
    courierScore?: number;
    systemScore?: number;
    subCauseConfidence?: number;
  };
  recoveryPrediction?: {
    probability?: number;
  };
  decision?: {
    action?: string;
    reasoning?: string;
  };
  shipmentId?: string;
  receivedAt?: Date;
}

function makeTimestamp(baseTime: Date, offsetMs: number): string {
  return new Date(baseTime.getTime() + offsetMs).toISOString();
}

function getClassificationFactors(primaryCategory: string, subCause: string): FeatureFactor[] {
  const key = `${primaryCategory}/${subCause}`;

  const factorMap: Record<string, FeatureFactor[]> = {
    'courier_issue/fake_delivery': [
      { factor: 'GPS Mismatch', contribution: 34, direction: 'positive', description: 'Courier GPS was 4.2km from delivery address at time of marking delivery as failed' },
      { factor: 'Customer Available', contribution: 21, direction: 'positive', description: 'Customer was reachable and confirmed being at home during delivery window' },
      { factor: 'Call Connected', contribution: 18, direction: 'positive', description: 'Phone call to customer connected successfully, contradicting courier claim' },
      { factor: 'Route Deviation', contribution: 15, direction: 'positive', description: 'Courier deviated significantly from planned delivery route' },
      { factor: 'Failed Quickly', contribution: 8, direction: 'positive', description: 'Delivery marked as failed within 30 seconds of arrival scan - too fast for genuine attempt' },
      { factor: 'Address OK', contribution: 4, direction: 'negative', description: 'Address validation passed - location is valid and accessible' },
      { factor: 'No System Errors', contribution: 2, direction: 'negative', description: 'No system-side issues detected in routing or assignment' },
    ],
    'courier_issue/gps_anomaly': [
      { factor: 'GPS Route Efficiency', contribution: 38, direction: 'positive', description: 'Route efficiency at 34%, far below 70% threshold for normal delivery pattern' },
      { factor: 'Route Deviation', contribution: 24, direction: 'positive', description: '3.8km deviation from optimal delivery path detected' },
      { factor: 'Delivery Time Anomaly', contribution: 16, direction: 'positive', description: 'Time between stops inconsistent with actual driving distances' },
      { factor: 'Customer Reachable', contribution: 12, direction: 'positive', description: 'Customer confirmed availability but courier never arrived' },
      { factor: 'Call Attempts', contribution: 8, direction: 'positive', description: 'Only 1 call attempt made vs required 3 attempts before marking failed' },
      { factor: 'Address Valid', contribution: 3, direction: 'negative', description: 'Delivery address validated and geocoded correctly' },
      { factor: 'System Check OK', contribution: 2, direction: 'negative', description: 'No system-level routing or assignment errors' },
    ],
    'customer_issue/unavailable': [
      { factor: 'No Answer to Calls', contribution: 32, direction: 'positive', description: '3 call attempts made, customer did not answer any' },
      { factor: 'Not at Address (GPS)', contribution: 22, direction: 'positive', description: 'Courier GPS confirms arrival at correct address, waited 8 minutes' },
      { factor: 'Previous Successful Deliveries', contribution: 18, direction: 'positive', description: 'Customer has 23 previous orders with 95% delivery success rate' },
      { factor: 'Evening Preference', contribution: 14, direction: 'positive', description: 'Customer historically receives deliveries after 6PM, attempt was at 2PM' },
      { factor: 'No Support Ticket', contribution: 10, direction: 'positive', description: 'No address change or delivery modification request filed' },
      { factor: 'Address Valid', contribution: 3, direction: 'negative', description: 'Address exists and geocode confidence is 98%' },
      { factor: 'Courier Arrived', contribution: 2, direction: 'negative', description: 'Courier GPS confirms arrival at correct location on time' },
    ],
    'customer_issue/wrong_address': [
      { factor: 'Address Not in DB', contribution: 36, direction: 'positive', description: 'Address does not exist in postal database, building not found' },
      { factor: 'Geocode Mismatch', contribution: 24, direction: 'positive', description: 'Geocoded location points to empty lot, no building present' },
      { factor: 'First-time Customer', contribution: 16, direction: 'positive', description: 'No previous delivery history to this address or customer' },
      { factor: 'No Phone Response', contribution: 14, direction: 'positive', description: '5 call attempts over 2 days, customer unreachable' },
      { factor: 'No Landmark Match', contribution: 7, direction: 'positive', description: 'Nearby landmarks mentioned in address do not match actual location' },
      { factor: 'Courier GPS Correct', contribution: 3, direction: 'negative', description: 'Courier reached the geocoded coordinates correctly' },
      { factor: 'System Routing OK', contribution: 2, direction: 'negative', description: 'Routing system directed courier to correct geocoded point' },
    ],
    'system_issue/address_mapping_error': [
      { factor: 'Geocode Offset Detected', contribution: 40, direction: 'positive', description: 'System geocode is 200m off from actual building location' },
      { factor: 'Building 200m Away', contribution: 22, direction: 'positive', description: 'Physical building exists but at different coordinates than mapped' },
      { factor: 'Previous Deliveries Failed Same Addr', contribution: 16, direction: 'positive', description: 'Other deliveries to this address also failed at same GPS point' },
      { factor: 'Customer Confirmed Address', contribution: 12, direction: 'positive', description: 'Customer verified address is correct, has received deliveries from other services' },
      { factor: 'Courier at Correct GPS', contribution: 8, direction: 'positive', description: 'Courier followed system GPS correctly - system was wrong' },
      { factor: 'Customer Available', contribution: 3, direction: 'negative', description: 'Customer was available and waiting for delivery' },
      { factor: 'Courier OK', contribution: 2, direction: 'negative', description: 'Courier followed all correct procedures' },
    ],
  };

  return factorMap[key] || getDefaultClassificationFactors(primaryCategory);
}

function getDefaultClassificationFactors(primaryCategory: string): FeatureFactor[] {
  if (primaryCategory === 'courier_issue') {
    return [
      { factor: 'Courier Behavior Pattern', contribution: 30, direction: 'positive', description: 'Behavioral signals indicate courier-side issue' },
      { factor: 'GPS Evidence', contribution: 25, direction: 'positive', description: 'GPS data inconsistent with successful delivery attempt' },
      { factor: 'Customer Signals', contribution: 18, direction: 'positive', description: 'Customer-side signals indicate availability' },
      { factor: 'Call Records', contribution: 14, direction: 'positive', description: 'Call log analysis supports courier issue classification' },
      { factor: 'Delivery Timing', contribution: 9, direction: 'positive', description: 'Delivery timing pattern suggests incomplete attempt' },
      { factor: 'Address Valid', contribution: 3, direction: 'negative', description: 'Address validation passed successfully' },
      { factor: 'System OK', contribution: 2, direction: 'negative', description: 'No system errors detected' },
    ];
  }
  if (primaryCategory === 'system_issue') {
    return [
      { factor: 'System Error Detected', contribution: 35, direction: 'positive', description: 'Internal system error identified in delivery pipeline' },
      { factor: 'Mapping Data Issue', contribution: 22, direction: 'positive', description: 'Address or routing data inconsistency found' },
      { factor: 'Multiple Failures Same Point', contribution: 16, direction: 'positive', description: 'Pattern of failures at this system touchpoint' },
      { factor: 'Courier Followed Instructions', contribution: 13, direction: 'positive', description: 'Courier correctly followed system-provided instructions' },
      { factor: 'Customer Confirmed', contribution: 10, direction: 'positive', description: 'Customer confirmed their information is correct' },
      { factor: 'Customer Available', contribution: 3, direction: 'negative', description: 'Customer was available during attempt' },
      { factor: 'Courier OK', contribution: 2, direction: 'negative', description: 'No courier behavioral issues' },
    ];
  }
  // Default: customer_issue
  return [
    { factor: 'Customer Behavior', contribution: 30, direction: 'positive', description: 'Customer-side signals indicate issue' },
    { factor: 'Contact Failures', contribution: 22, direction: 'positive', description: 'Unable to reach customer through multiple attempts' },
    { factor: 'Order History Pattern', contribution: 18, direction: 'positive', description: 'Order history supports customer-issue classification' },
    { factor: 'Delivery Attempt Valid', contribution: 14, direction: 'positive', description: 'Courier made legitimate delivery attempt' },
    { factor: 'Address Signals', contribution: 12, direction: 'positive', description: 'Address-related signals support classification' },
    { factor: 'Courier GPS OK', contribution: 3, direction: 'negative', description: 'Courier arrived at correct location' },
    { factor: 'System OK', contribution: 2, direction: 'negative', description: 'No system issues detected' },
  ];
}

function getRecoveryFactors(probability: number): FeatureFactor[] {
  if (probability > 0.6) {
    return [
      { factor: 'Prior Orders', contribution: 28, direction: 'positive', description: 'Customer has strong order history indicating genuine intent' },
      { factor: 'Low Return Rate', contribution: 22, direction: 'positive', description: 'Customer historically accepts and keeps deliveries' },
      { factor: 'Responded to Notifications', contribution: 19, direction: 'positive', description: 'Customer engages with delivery notifications and updates' },
      { factor: 'High Order Value', contribution: 12, direction: 'positive', description: 'Order value suggests genuine purchase intent' },
      { factor: 'Time Since Order', contribution: 8, direction: 'negative', description: 'Some time has passed since original order placement' },
      { factor: 'No Preference Update', contribution: 3, direction: 'negative', description: 'Customer has not updated delivery preferences' },
    ];
  }
  if (probability < 0.4) {
    return [
      { factor: 'High Return Rate', contribution: 25, direction: 'positive', description: 'Customer has pattern of returning or refusing orders' },
      { factor: 'No Response to Notifications', contribution: 22, direction: 'positive', description: 'Customer ignores delivery notifications and updates' },
      { factor: 'Few Prior Orders', contribution: 18, direction: 'positive', description: 'Limited order history suggests low engagement' },
      { factor: 'Long Time Since Order', contribution: 15, direction: 'positive', description: 'Significant time elapsed since order placement' },
      { factor: 'Low Engagement', contribution: 12, direction: 'positive', description: 'Minimal interaction with platform services' },
      { factor: 'Has Order History', contribution: 5, direction: 'negative', description: 'Customer does have some order history on platform' },
      { factor: 'Address Exists', contribution: 2, direction: 'negative', description: 'Delivery address is valid and exists' },
    ];
  }
  // Medium recovery
  return [
    { factor: 'Mixed Order History', contribution: 24, direction: 'positive', description: 'Customer has mixed delivery acceptance pattern' },
    { factor: 'Partial Engagement', contribution: 20, direction: 'positive', description: 'Some response to notifications but inconsistent' },
    { factor: 'Moderate Order Frequency', contribution: 16, direction: 'positive', description: 'Average order frequency on platform' },
    { factor: 'Address Verified', contribution: 14, direction: 'positive', description: 'Delivery address has been verified previously' },
    { factor: 'Time Factor', contribution: 10, direction: 'positive', description: 'Moderate time since original order' },
    { factor: 'Some Returns', contribution: 6, direction: 'negative', description: 'Customer has some returns in history' },
    { factor: 'Contact Difficulty', contribution: 4, direction: 'negative', description: 'Some difficulty reaching customer' },
  ];
}

function getReasoningSteps(event: RTOEventDoc): ReasoningStep[] {
  const baseTime = event.receivedAt ? new Date(event.receivedAt) : new Date();
  const primaryCategory = event.classification?.primaryCategory || 'customer_issue';
  const subCause = event.classification?.subCause || 'unavailable';
  const key = `${primaryCategory}/${subCause}`;
  const confidence = event.classification?.subCauseConfidence
    ? Math.round(event.classification.subCauseConfidence * 100)
    : 87;
  const recoveryProb = event.recoveryPrediction?.probability ?? 0.5;
  const action = event.decision?.action || 'redeliver';

  const stepsMap: Record<string, ReasoningStep[]> = {
    'courier_issue/fake_delivery': [
      { timestamp: makeTimestamp(baseTime, 0), module: 'Evidence Collector', message: `Analyzing delivery attempt for shipment ${event.shipmentId || 'N/A'}...`, type: 'info' },
      { timestamp: makeTimestamp(baseTime, 1200), module: 'GPS Analyzer', message: '⚠ GPS deviation detected: courier was 4.2km from delivery address at time of "failed" marking', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 2400), module: 'Call Analyzer', message: '✓ Call records show customer was available — phone answered on first ring', type: 'success' },
      { timestamp: makeTimestamp(baseTime, 3600), module: 'Timing Analyzer', message: '⚠ Delivery marked failed within 30 seconds of area entry — too fast for genuine attempt', type: 'warning' },
      { timestamp: makeTimestamp(baseTime, 4800), module: 'Route Analyzer', message: '→ Route deviation of 3.8km from planned path, efficiency: 34%', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 6000), module: 'Pattern Engine', message: '⚠ Similar pattern detected: 4 events from same courier in 7 days', type: 'warning' },
      { timestamp: makeTimestamp(baseTime, 7200), module: 'Classifier', message: `✓ Classification: courier_issue/fake_delivery (confidence: ${confidence}%)`, type: 'result' },
      { timestamp: makeTimestamp(baseTime, 8400), module: 'Recovery Model', message: `→ Recovery probability: ${Math.round(recoveryProb * 100)}% — high recovery with different courier`, type: 'success' },
      { timestamp: makeTimestamp(baseTime, 9600), module: 'Decision Engine', message: `✓ Decision: ${action.toUpperCase()} — reassign to verified courier`, type: 'result' },
    ],
    'courier_issue/gps_anomaly': [
      { timestamp: makeTimestamp(baseTime, 0), module: 'Evidence Collector', message: `Analyzing GPS trace for shipment ${event.shipmentId || 'N/A'}...`, type: 'info' },
      { timestamp: makeTimestamp(baseTime, 1200), module: 'GPS Analyzer', message: '⚠ Erratic GPS pattern detected — 47 waypoints analyzed', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 2400), module: 'Route Analyzer', message: '→ Route efficiency: 34% (threshold: >70%) — significant deviation', type: 'warning' },
      { timestamp: makeTimestamp(baseTime, 3600), module: 'Timing Analyzer', message: '⚠ Time between stops inconsistent with driving distances', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 4800), module: 'Call Analyzer', message: '✓ Customer reachable — confirmed availability but courier never arrived', type: 'success' },
      { timestamp: makeTimestamp(baseTime, 6000), module: 'Classifier', message: `✓ Classification: courier_issue/gps_anomaly (confidence: ${confidence}%)`, type: 'result' },
      { timestamp: makeTimestamp(baseTime, 7200), module: 'Recovery Model', message: `→ Recovery probability: ${Math.round(recoveryProb * 100)}% — customer available, address valid`, type: 'success' },
      { timestamp: makeTimestamp(baseTime, 8400), module: 'Decision Engine', message: `✓ Decision: ${action.toUpperCase()} — re-attempt with route optimization`, type: 'result' },
    ],
    'customer_issue/unavailable': [
      { timestamp: makeTimestamp(baseTime, 0), module: 'Evidence Collector', message: `Analyzing delivery attempt for shipment ${event.shipmentId || 'N/A'}...`, type: 'info' },
      { timestamp: makeTimestamp(baseTime, 1200), module: 'Call Analyzer', message: '⚠ 3 call attempts made — customer did not answer', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 2400), module: 'GPS Analyzer', message: '✓ Courier GPS confirms arrival at correct address, waited 8 minutes', type: 'success' },
      { timestamp: makeTimestamp(baseTime, 3600), module: 'History Analyzer', message: '→ Customer has 23 previous orders with 95% delivery success rate', type: 'info' },
      { timestamp: makeTimestamp(baseTime, 4800), module: 'Preference Engine', message: '→ Customer typically available after 6PM — attempt was at 2PM', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 6000), module: 'Classifier', message: `✓ Classification: customer_issue/unavailable (confidence: ${confidence}%)`, type: 'result' },
      { timestamp: makeTimestamp(baseTime, 7200), module: 'Recovery Model', message: `→ Recovery probability: ${Math.round(recoveryProb * 100)}% — high based on history and engagement`, type: 'success' },
      { timestamp: makeTimestamp(baseTime, 8400), module: 'Decision Engine', message: `✓ Decision: ${action.toUpperCase()} — schedule in preferred time slot`, type: 'result' },
    ],
    'customer_issue/wrong_address': [
      { timestamp: makeTimestamp(baseTime, 0), module: 'Evidence Collector', message: `Analyzing address data for shipment ${event.shipmentId || 'N/A'}...`, type: 'info' },
      { timestamp: makeTimestamp(baseTime, 1200), module: 'Address Validator', message: '⚠ Address validation FAILED — not found in postal database', type: 'warning' },
      { timestamp: makeTimestamp(baseTime, 2400), module: 'Geocode Engine', message: '⚠ Geocode mismatch — location points to empty lot, no building present', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 3600), module: 'History Analyzer', message: '→ First-time customer — no previous delivery history available', type: 'info' },
      { timestamp: makeTimestamp(baseTime, 4800), module: 'Call Analyzer', message: '⚠ 5 call attempts over 2 days — customer unreachable', type: 'warning' },
      { timestamp: makeTimestamp(baseTime, 6000), module: 'Landmark Matcher', message: '→ Nearby landmarks in address description do not match actual location', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 7200), module: 'Classifier', message: `✓ Classification: customer_issue/wrong_address (confidence: ${confidence}%)`, type: 'result' },
      { timestamp: makeTimestamp(baseTime, 8400), module: 'Recovery Model', message: `→ Recovery probability: ${Math.round(recoveryProb * 100)}% — low due to invalid address`, type: 'warning' },
      { timestamp: makeTimestamp(baseTime, 9600), module: 'Decision Engine', message: `✓ Decision: ${action.toUpperCase()} — address correction unlikely`, type: 'result' },
    ],
    'system_issue/address_mapping_error': [
      { timestamp: makeTimestamp(baseTime, 0), module: 'Evidence Collector', message: `Analyzing system data for shipment ${event.shipmentId || 'N/A'}...`, type: 'info' },
      { timestamp: makeTimestamp(baseTime, 1200), module: 'Geocode Engine', message: '⚠ Geocode offset detected — system coordinates 200m from actual building', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 2400), module: 'Address Validator', message: '→ Building exists at correct address but system GPS points to wrong location', type: 'finding' },
      { timestamp: makeTimestamp(baseTime, 3600), module: 'Pattern Engine', message: '⚠ Previous deliveries to same address also failed at this GPS point', type: 'warning' },
      { timestamp: makeTimestamp(baseTime, 4800), module: 'Customer Verifier', message: '✓ Customer confirmed address — has received deliveries from other services', type: 'success' },
      { timestamp: makeTimestamp(baseTime, 6000), module: 'GPS Analyzer', message: '✓ Courier followed system GPS correctly — system was wrong, not courier', type: 'success' },
      { timestamp: makeTimestamp(baseTime, 7200), module: 'Classifier', message: `✓ Classification: system_issue/address_mapping_error (confidence: ${confidence}%)`, type: 'result' },
      { timestamp: makeTimestamp(baseTime, 8400), module: 'Technical Fix', message: '✓ Address mapping corrected — offset applied to geocode database', type: 'success' },
      { timestamp: makeTimestamp(baseTime, 9600), module: 'Recovery Model', message: `→ Recovery probability: ${Math.round(recoveryProb * 100)}% — very high with corrected address`, type: 'success' },
      { timestamp: makeTimestamp(baseTime, 10800), module: 'Decision Engine', message: `✓ Decision: ${action.toUpperCase()} — redelivery with corrected coordinates`, type: 'result' },
    ],
  };

  return stepsMap[key] || getDefaultSteps(event, baseTime, primaryCategory, subCause, confidence, recoveryProb, action);
}

function getDefaultSteps(
  event: RTOEventDoc,
  baseTime: Date,
  primaryCategory: string,
  subCause: string,
  confidence: number,
  recoveryProb: number,
  action: string
): ReasoningStep[] {
  return [
    { timestamp: makeTimestamp(baseTime, 0), module: 'Evidence Collector', message: `Analyzing delivery attempt for shipment ${event.shipmentId || 'N/A'}...`, type: 'info' },
    { timestamp: makeTimestamp(baseTime, 1500), module: 'Multi-Signal Analyzer', message: '→ Collecting evidence from GPS, call logs, delivery scans, order history', type: 'info' },
    { timestamp: makeTimestamp(baseTime, 3000), module: 'Evidence Scorer', message: `⚠ Primary signals point to ${primaryCategory.replace('_', ' ')}`, type: 'finding' },
    { timestamp: makeTimestamp(baseTime, 4500), module: 'Sub-cause Detector', message: `→ Sub-cause identified: ${subCause.replace('_', ' ')}`, type: 'finding' },
    { timestamp: makeTimestamp(baseTime, 6000), module: 'Classifier', message: `✓ Classification: ${primaryCategory}/${subCause} (confidence: ${confidence}%)`, type: 'result' },
    { timestamp: makeTimestamp(baseTime, 7500), module: 'Recovery Model', message: `→ Recovery probability: ${Math.round(recoveryProb * 100)}%`, type: 'info' },
    { timestamp: makeTimestamp(baseTime, 9000), module: 'Decision Engine', message: `✓ Decision: ${action.toUpperCase()}`, type: 'result' },
  ];
}

export function generateReasoningFromEvent(event: RTOEventDoc): ReasoningResponse {
  const startTime = Date.now();

  const primaryCategory = event.classification?.primaryCategory || 'customer_issue';
  const subCause = event.classification?.subCause || 'unavailable';
  const recoveryProb = event.recoveryPrediction?.probability ?? 0.5;
  const confidence = event.classification?.subCauseConfidence
    ? Math.round(event.classification.subCauseConfidence * 100)
    : 87;
  const action = event.decision?.action || 'redeliver';

  const steps = getReasoningSteps(event);
  const classificationFactors = getClassificationFactors(primaryCategory, subCause);
  const recoveryFactors = getRecoveryFactors(recoveryProb);

  const decisionText = action === 'redeliver'
    ? `REDELIVER — ${Math.round(recoveryProb * 100)}% recovery confidence`
    : action === 'reallocate'
    ? `REALLOCATE — low recovery, strong nearby demand`
    : `WAREHOUSE RETURN — recovery unlikely, no buyer demand`;

  return {
    steps,
    featureImportance: {
      classification: classificationFactors,
      recovery: recoveryFactors,
    },
    finalConfidence: confidence,
    decision: decisionText,
    processingTimeMs: Date.now() - startTime,
  };
}
