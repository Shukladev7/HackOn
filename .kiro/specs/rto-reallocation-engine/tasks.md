# Implementation Plan: RTO Reallocation Engine

## Overview

This plan implements an AI-powered In-Transit Inventory Reallocation Engine that intercepts RTO shipments and determines optimal next actions (redeliver, reallocate, or warehouse return). The system uses a modular event-driven architecture with Node.js/Express for the API server, Python/FastAPI for ML services, React/Vite for the dashboard, MongoDB for persistence, and Redis Streams for event buffering.

## Tasks

- [x] 1. Project scaffolding and infrastructure setup
  - [x] 1.1 Initialize monorepo structure with backend, ML service, and frontend projects
    - Create directory structure: `backend/` (Node.js + Express + TypeScript), `ml-service/` (Python + FastAPI), `frontend/` (React + Vite + TypeScript)
    - Set up `package.json` with TypeScript, Express, Mongoose, ioredis, fast-check, vitest dependencies in `backend/`
    - Set up `requirements.txt` with FastAPI, uvicorn, scikit-learn, openai, hypothesis, pydantic in `ml-service/`
    - Set up Vite React TypeScript project in `frontend/`
    - Create `docker-compose.yml` for MongoDB and Redis local development
    - _Requirements: 10.1, 11.1_

  - [x] 1.2 Configure TypeScript, ESLint, and testing frameworks for backend
    - Create `tsconfig.json` with strict mode
    - Configure Vitest for unit and property-based tests
    - Set up fast-check as the property-based testing library
    - Create `src/` directory structure matching the design: `services/`, `models/`, `routes/`, `utils/`, `config/`
    - _Requirements: 11.1_

  - [x] 1.3 Configure Python project structure and testing for ML service
    - Create project layout: `src/ml/`, `src/api/`, `tests/`
    - Configure pytest with Hypothesis for property-based testing
    - Set up FastAPI application factory with CORS and health endpoints
    - _Requirements: 11.1_

  - [x] 1.4 Set up shared configuration and environment variables
    - Create `.env.example` with all configurable thresholds (confidence: 0.6, recovery: 0.3, radius: 50km, weights, buffer size)
    - Implement config loader in `backend/src/config/index.ts` reading from environment with defaults
    - Implement config loader in `ml-service/src/config.py`
    - _Requirements: 3.2, 4.1, 5.1, 6.2, 6.4, 12.6_

- [x] 2. Database models and MongoDB setup
  - [-] 2.1 Create Mongoose schemas for all core entities
    - Implement schemas for: Customer, Order, Courier, DeliveryAttempt, RTOEvent, HubEvent, ReallocationEvent, DecisionRecord, EventStream, EvidenceStore
    - Define relationships: Order → Customer, DeliveryAttempt → Order + Courier, RTOEvent → DeliveryAttempt, HubEvent → RTOEvent, ReallocationEvent → RTOEvent + Order
    - Add geospatial field types for customer addresses and hub locations (`2dsphere`)
    - _Requirements: 10.1, 10.3_

  - [x] 2.2 Create MongoDB indexes for performance
    - Add 2dsphere index on `customers.address.geoLocation` for demand matching
    - Add compound indexes for time-based evidence queries (`hub_events.rtoEventId + occurredAt`)
    - Add courier escalation indexes (`rto_events.courierId + receivedAt`)
    - Add TTL index on `evidence_store.collectedAt` for 90-day retention
    - Add fraud detection indexes (`customers.fraudFlag.flagged`, `rto_events.customerId + receivedAt`)
    - _Requirements: 2.4, 5.1, 9.2, 10.4, 10.6, 12.6_

  - [-] 2.3 Implement database connection manager with retry logic
    - Create MongoDB connection utility with connection pooling
    - Add reconnection logic with exponential backoff
    - Implement health check endpoint for database connectivity
    - _Requirements: 11.4_

- [x] 3. Event ingress and message queue
  - [-] 3.1 Implement Redis Streams producer and consumer utilities
    - Create `backend/src/utils/redisStreams.ts` with publish/subscribe patterns
    - Implement consumer group management for pipeline stages
    - Add connection pooling and reconnection handling
    - _Requirements: 10.2, 11.3_

  - [x] 3.2 Implement Event Ingress Service with schema validation
    - Create `POST /api/v1/rto-events` endpoint
    - Validate incoming RTOEventPayload against the defined interface schema
    - Implement deduplication check using `shipmentId + attemptNumber` as idempotency key
    - Publish validated events to Redis Stream `rto-events` topic
    - Return `{ eventId, accepted }` response
    - _Requirements: 10.1, 10.2, 11.1_

  - [x] 3.3 Implement event buffering with capacity management
    - Add buffer depth tracking (max 500,000 events)
    - Implement capacity-exceeded rejection with event ID persistence for reprocessing
    - Add dead letter queue for events that exhaust retries
    - _Requirements: 11.3, 11.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Evidence Collection Engine
  - [x] 5.1 Implement package eligibility verification
    - Create `backend/src/services/evidenceCollection.ts`
    - Implement `verifyEligibility()` checking seal intact, no damage, no tamper indicators from HubEvents and delivery scans
    - Return `EligibilityResult` with pass/fail per condition and evidence IDs
    - Route ineligible packages to Decision Engine for warehouse return with failed condition details
    - Must complete within 10 seconds of event receipt
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 5.2 Write property test for eligibility determination (Property 1)
    - **Property 1: Eligibility Determination Correctness**
    - Generate random evidence payloads with all combinations of seal/damage/tamper indicators
    - Assert: eligible=true iff all three conditions pass; ineligible routes to warehouse with failed conditions recorded
    - **Validates: Requirements 1.1, 1.2**

  - [x] 5.3 Implement parallel evidence collection with timeout handling
    - Implement `collectEvidence()` fetching from 7 sources (GPS, call logs, delivery scans, order history, support tickets, address validation, hub events) with 5-second per-source timeout
    - Use `Promise.allSettled()` for parallel collection with individual timeouts
    - Proceed if ≥3 of 7 sources respond; record unavailable sources with timeout timestamps
    - Collect evidence from 72-hour lookback window
    - Total collection must complete within 30 seconds
    - _Requirements: 2.1, 2.2_

  - [ ]* 5.4 Write property test for evidence source resilience (Property 2)
    - **Property 2: Evidence Source Resilience**
    - Generate random 7-element boolean arrays representing source availability
    - Assert: proceeds iff ≥3 sources available; unavailable sources recorded with timestamps
    - **Validates: Requirements 2.2**

  - [x] 5.5 Implement evidence normalization and persistence
    - Implement `normalizeEvidence()` converting raw sources to standardized `NormalizedEvidence` schema
    - Include completeness metadata (collected sources, unavailable sources, timeout timestamps)
    - Persist raw evidence to `evidence_store` collection with 90-day TTL
    - Link each record to originating RTO_Event ID
    - _Requirements: 2.3, 2.4, 2.5_

  - [ ]* 5.6 Write property test for evidence normalization (Property 3)
    - **Property 3: Evidence Normalization Completeness**
    - Generate random raw evidence arrays
    - Assert: output conforms to schema with completeness metadata; every record has valid rtoEventId
    - **Validates: Requirements 2.3, 2.5**

- [x] 6. Root Cause Classifier (Python ML service)
  - [x] 6.1 Implement Root Cause Classifier with OpenAI API integration
    - Create `ml-service/src/ml/root_cause_classifier.py`
    - Implement `classify()` method that builds structured prompt from normalized evidence
    - Parse OpenAI response to extract customer/courier/system scores (each 0.0-1.0, independent)
    - Implement `_determine_primary_category()` with threshold check and priority order (Courier > System > Customer)
    - Route to manual review queue if no score exceeds configurable threshold (default: 0.6)
    - Must complete within 10 seconds
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 6.2 Implement sub-cause identification for each root cause category
    - Implement Customer sub-causes: unavailable, wrong_address, refused_delivery, cancellation, not_interested
    - Implement Courier sub-causes: fake_attempt, no_contact, gps_anomaly, route_deviation, incorrect_status, failed_despite_available
    - Implement System sub-causes: address_mapping, routing_engine, order_sync, wrong_logistics, platform_bug
    - Assign "unspecified" if sub-cause confidence < 0.5
    - _Requirements: 3.4, 3.5, 3.6, 3.7_

  - [x] 6.3 Create FastAPI endpoint for classification
    - Create `POST /ml/v1/classify` endpoint
    - Accept normalized evidence payload, return `ClassificationResult`
    - Add request validation with Pydantic models
    - Implement circuit breaker for OpenAI API calls
    - _Requirements: 3.1_

  - [ ]* 6.4 Write property test for classification score validity (Property 4)
    - **Property 4: Classification Score Validity**
    - Generate random normalized evidence objects
    - Assert: all scores in [0.0, 1.0]; primary category is highest above threshold with correct tie-breaking; manual review triggered when no score exceeds threshold
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]* 6.5 Write property test for sub-cause assignment (Property 5)
    - **Property 5: Sub-Cause Assignment Validity**
    - Generate random classifications with category above threshold
    - Assert: sub-cause is valid enum member for category or "unspecified" if confidence < 0.5
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.7**

- [x] 7. Sale Recovery Predictor (Python ML service)
  - [x] 7.1 Implement Sale Recovery Predictor with scikit-learn
    - Create `ml-service/src/ml/sale_recovery_predictor.py`
    - Implement feature extraction: prior_orders, return_rate, avg_order_value, hours_since_order, product_category, price_tier, communication signals
    - Implement population median imputation for missing features with imputation flagging
    - Train/load logistic regression model for recovery probability prediction
    - Must complete within 5 seconds
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 7.2 Create FastAPI endpoint for recovery prediction
    - Create `POST /ml/v1/predict-recovery` endpoint
    - Accept classification + customer/order data, return `RecoveryPrediction`
    - Add Pydantic request/response models
    - _Requirements: 4.1, 4.2_

  - [ ]* 7.3 Write property test for recovery probability validity (Property 6)
    - **Property 6: Recovery Probability Output Validity**
    - Generate random customer/order data with missing fields
    - Assert: probability in [0.0, 1.0]; missing features imputed with medians; partially_imputed flagged correctly
    - **Validates: Requirements 4.1, 4.3, 4.4**

- [x] 8. Demand Matching Engine
  - [x] 8.1 Implement geospatial candidate search
    - Create `backend/src/services/demandMatching.ts`
    - Implement `findCandidates()` using MongoDB 2dsphere index for radius-based search
    - Search four demand sources: existing orders (same SKU), cart items (added within 7 days), wishlist entries, predicted intent (score > threshold)
    - Must complete within 15 seconds
    - _Requirements: 5.1, 5.2_

  - [x] 8.2 Implement refusal filtering and candidate validation
    - Implement `filterRefusals()` excluding candidates who refused same product category within 90 days
    - Validate cart recency (7-day window)
    - Validate intent score against configurable threshold (default: 0.6)
    - _Requirements: 5.4, 5.2_

  - [ ]* 8.3 Write property test for geospatial radius constraint (Property 7)
    - **Property 7: Geospatial Candidate Radius Constraint**
    - Generate random geo-coordinates and radii
    - Assert: all returned candidates have distance ≤ configured radius
    - **Validates: Requirements 5.1**

  - [ ]* 8.4 Write property test for demand source validity and refusal filtering (Property 8)
    - **Property 8: Demand Source Validity and Refusal Filtering**
    - Generate random candidates with refusal histories
    - Assert: matchType from valid set with source-specific criteria; refused candidates excluded
    - **Validates: Requirements 5.2, 5.4**

- [x] 9. Buyer Ranking Engine
  - [x] 9.1 Implement composite score calculation with configurable weights
    - Create `backend/src/services/buyerRanking.ts`
    - Implement weighted scoring: distance (0.25), conversion probability (0.35), delivery speed (0.20), margin impact (0.20)
    - Handle missing factors with neutral value 0.5 and partial scoring flag
    - Ensure weights sum to 1.0
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 9.2 Implement candidate ranking, filtering, and output limits
    - Filter candidates below configurable minimum threshold (default: 0.4)
    - Sort by descending composite score, ties broken by shortest distance
    - Return at most 10 candidates
    - Return empty list if all candidates filtered out
    - _Requirements: 6.4, 6.5, 6.6_

  - [ ]* 9.3 Write property test for composite score computation (Property 9)
    - **Property 9: Composite Score Computation**
    - Generate random factor values and weight configurations summing to 1.0
    - Assert: composite score equals weighted sum; unavailable factors assigned 0.5; result in [0.0, 1.0]
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]* 9.4 Write property test for ranking output ordering (Property 10)
    - **Property 10: Ranking Output Ordering and Filtering**
    - Generate random scored candidates
    - Assert: ≤10 returned; descending order; ties broken by distance; all scores ≥ threshold
    - **Validates: Requirements 6.4, 6.5, 6.6**

- [x] 10. Decision Engine orchestration
  - [x] 10.1 Implement Decision Engine with action selection logic
    - Create `backend/src/services/decisionEngine.ts`
    - Implement `processRTOEvent()` orchestrating the full pipeline
    - Courier issue + recovery > 0.5 → redeliver (exclude flagged courier)
    - Courier issue + recovery ≤ 0.5 → demand matching → reallocate
    - System issue → technical correction + redeliver
    - Customer issue + recovery > threshold → redeliver
    - Customer issue + recovery ≤ threshold + buyers → reallocate to top buyer
    - No viable action → warehouse return
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 10.2 Implement decision record generation
    - Generate complete `DecisionRecord` for every decision containing: rtoEventId, root cause category/sub-cause, all three confidence scores, selected action, specific input values (recovery probability, candidate count, top buyer score), and human-readable reasoning
    - Persist to `decision_records` collection
    - _Requirements: 7.7_

  - [x] 10.3 Implement fraud detection checks in pipeline
    - Check customer and courier RTO event counts within configurable window (default: 5 events in 30 days)
    - Flag entity for fraud investigation when threshold exceeded
    - Suspend reallocation eligibility for flagged entities
    - Generate compliance team alert
    - _Requirements: 12.6, 12.7_

  - [x] 10.4 Implement downstream retry with exponential backoff
    - Add retry logic: 1s, 2s, 4s (3 attempts, max 7s total)
    - Route to warehouse return when retries exhausted
    - Integrate circuit breaker pattern per inter-service call
    - _Requirements: 11.4_

  - [ ]* 10.5 Write property test for decision action selection (Property 11)
    - **Property 11: Decision Engine Action Selection**
    - Generate random classification + recovery + buyer list combinations
    - Assert: correct action selected per decision matrix rules
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**

  - [ ]* 10.6 Write property test for decision record completeness (Property 12)
    - **Property 12: Decision Record Completeness**
    - Generate random decision scenarios
    - Assert: record contains all required fields (rtoEventId, rootCause, scores, action, inputs, reasoning)
    - **Validates: Requirements 7.7**

  - [ ]* 10.7 Write property test for downstream retry policy (Property 16)
    - **Property 16: Downstream Retry Policy**
    - Generate random service failure patterns
    - Assert: retries with exponential backoff (1s, 2s, 4s), max 3 attempts; warehouse return on exhaustion; capacity-exceeded rejection when buffer full
    - **Validates: Requirements 11.4, 11.5**

  - [ ]* 10.8 Write property test for fraud detection threshold (Property 20)
    - **Property 20: Fraud Detection Threshold**
    - Generate random entity RTO histories
    - Assert: flagged when count ≥ threshold in window; reallocation suspended while flagged
    - **Validates: Requirements 12.6, 12.7**

- [x] 11. Checkpoint - Ensure core pipeline tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Reallocation Service execution
  - [x] 12.1 Implement reallocation execution pipeline
    - Create `backend/src/services/reallocationService.ts`
    - Implement `execute()` with steps: order creation → label generation → buyer notification → original customer notification
    - Create new order record linked to selected buyer with original order ID and reallocation event ID (within 30 seconds)
    - Generate shipping label with new buyer's delivery address
    - Send buyer notification with estimated delivery time (within 60 seconds of label)
    - Update original order status to "reallocated" and notify original customer
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 12.2 Implement reallocation rollback and buyer fallback
    - Implement `rollback()` reverting completed steps on failure
    - Implement `attemptNextBuyer()` trying next-ranked buyer on failure
    - Route to warehouse return if all buyers exhausted
    - Handle failed redelivery (2 consecutive failures or explicit refusal) → warehouse return
    - _Requirements: 8.5, 8.6_

  - [x] 12.3 Implement GST document generation for reallocations
    - Generate GST credit note for original order (GSTIN, HSN code, taxable value, tax rates)
    - Generate GST tax invoice for new buyer
    - Validate product-specific restrictions (hazardous, age-restricted, region-locked)
    - Reject ineligible buyers and try next-ranked
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ]* 12.4 Write property test for reallocation failure cascade (Property 13)
    - **Property 13: Reallocation Failure Cascade**
    - Generate random step failure scenarios
    - Assert: failed steps rolled back; next buyer attempted; 2 failed attempts → warehouse return
    - **Validates: Requirements 8.5, 8.6**

  - [ ]* 12.5 Write property test for GST document generation (Property 17)
    - **Property 17: GST Document Generation**
    - Generate random product/buyer/order data
    - Assert: credit note and invoice generated with valid GSTIN, HSN, taxable value, tax rates
    - **Validates: Requirements 12.1**

  - [ ]* 12.6 Write property test for product restriction validation (Property 18)
    - **Property 18: Product Restriction Validation**
    - Generate random product-buyer restriction pairs
    - Assert: ineligible buyers rejected; next buyer attempted; warehouse return when none eligible
    - **Validates: Requirements 12.2, 12.3**

  - [ ]* 12.7 Write property test for audit trail completeness (Property 19)
    - **Property 19: Audit Trail Completeness**
    - Generate random reallocation executions
    - Assert: audit trail contains original order ID, RTO_Event ID, classification, rationale, new order ID, timestamps, actor
    - **Validates: Requirements 12.5**

- [x] 13. Courier Escalation Service
  - [x] 13.1 Implement courier escalation alert generation
    - Create `backend/src/services/courierEscalation.ts`
    - Implement `checkForEscalation()` triggering on sub-causes: fake_delivery_attempt, gps_anomaly, route_deviation
    - Generate alert within 60 seconds with GPS traces, call logs, scan timestamps, address validation, hub events
    - Note missing evidence sources that were unavailable
    - _Requirements: 9.1, 9.3, 9.4_

  - [x] 13.2 Implement courier performance review threshold
    - Implement `checkPerformanceThreshold()` monitoring 7-day rolling window
    - Generate performance review notification when courier accumulates ≥3 courier issues in window
    - Include courier ID and associated Courier_Issue records
    - _Requirements: 9.2_

  - [ ]* 13.3 Write property test for courier escalation trigger (Property 14)
    - **Property 14: Courier Escalation Trigger**
    - Generate random courier histories with sub-causes
    - Assert: alert generated for specified sub-causes with required evidence; performance review at ≥3 issues in 7 days
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

- [x] 14. Event stream and observability infrastructure
  - [x] 14.1 Implement event stream emission with retry and buffering
    - Create `backend/src/services/eventStream.ts`
    - Emit events on all state transitions within 500ms containing: eventType, sourceEntityId, targetEntityId, timestamp, actorModule, outcomeStatus, inputParams
    - Buffer locally when stream unavailable; retry up to 5 times with exponential backoff
    - Persist to disk if buffer exhausted; reconcile later
    - _Requirements: 10.2, 10.5_

  - [ ]* 14.2 Write property test for event stream emission (Property 15)
    - **Property 15: Event Stream Emission with Retry**
    - Generate random stream failure patterns
    - Assert: events contain all required fields; buffered on failure; retried 5x with backoff; no events lost
    - **Validates: Requirements 10.2, 10.5**

- [x] 15. Metrics and Observability
  - [x] 15.1 Implement metrics aggregation service
    - Create `backend/src/services/metricsService.ts`
    - Compute: RTO reduction rate, reverse logistics savings, delivery success rate, inventory recovery rate, CO₂ reduction, customer satisfaction
    - Update dashboard metrics within 5 minutes of decision recording
    - Retain metric data for minimum 12 months
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 15.2 Implement anomaly detection for metrics
    - Calculate 30-day moving average and standard deviation per metric
    - Generate alert when value deviates > 2 standard deviations
    - Omit anomaly detection when fewer than 30 data points available
    - Include metric name, current value, expected range, deviation magnitude in alerts
    - _Requirements: 13.4, 13.5_

  - [x] 15.3 Create metrics API endpoints
    - `GET /api/v1/metrics` — current system metrics
    - `GET /api/v1/metrics/compare` — period-over-period comparison (daily, weekly, monthly)
    - `GET /api/v1/metrics/anomalies` — active anomaly alerts
    - _Requirements: 13.1, 13.3_

  - [ ]* 15.4 Write property test for metrics computation (Property 21)
    - **Property 21: Metrics Computation Correctness**
    - Generate random decision record sets
    - Assert: RTO reduction rate = non-warehouse events / total events; period change = (current - previous) / previous × 100
    - **Validates: Requirements 13.1, 13.3**

  - [ ]* 15.5 Write property test for anomaly detection (Property 22)
    - **Property 22: Anomaly Detection**
    - Generate random metric time series
    - Assert: alert iff value > 2σ from 30-day mean; no alert when < 30 data points
    - **Validates: Requirements 13.4, 13.5**

- [x] 16. Checkpoint - Ensure backend services complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Frontend dashboard
  - [x] 17.1 Set up React dashboard with routing and layout
    - Create main layout with sidebar navigation
    - Set up React Router with pages: Dashboard, RTO Events, Decisions, Courier Escalations, Metrics, Configuration
    - Configure API client for backend communication
    - _Requirements: 13.1_

  - [x] 17.2 Implement real-time metrics dashboard page
    - Display all 6 key metrics with current values and trend indicators
    - Show period-over-period comparisons (daily/weekly/monthly toggle)
    - Display active anomaly alerts with severity indicators
    - Implement auto-refresh with configurable interval
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 17.3 Implement RTO event timeline and decision detail views
    - Create RTO event list with filtering by status, date range, root cause
    - Implement timeline view showing full pipeline progression per event
    - Display decision record with root cause, scores, action, reasoning
    - _Requirements: 10.4, 7.7_

  - [x] 17.4 Implement courier escalation management view
    - Display escalation alerts with evidence summary
    - Show courier performance history and RTO patterns
    - Allow resolution/acknowledgment of escalation alerts
    - _Requirements: 9.1, 9.2_

  - [x] 17.5 Implement configuration management page
    - Display all configurable thresholds with current values
    - Allow updating: confidence threshold, recovery threshold, search radius, ranking weights, fraud thresholds
    - Connect to `PATCH /api/v1/config` endpoint
    - _Requirements: 3.2, 4.1, 5.1, 6.2, 6.4, 12.6_

- [x] 18. REST API routes and wiring
  - [x] 18.1 Implement remaining Express API routes
    - `GET /api/v1/rto-events/:id` — event details
    - `GET /api/v1/rto-events/:id/decision` — decision record
    - `GET /api/v1/rto-events/:id/timeline` — full event timeline
    - `GET /api/v1/orders/:id/history` — order decision history (within 2 seconds)
    - `GET /api/v1/packages/:id/history` — package decision history
    - `GET /api/v1/couriers/:id/escalations` — courier escalation history
    - `GET /api/v1/config` / `PATCH /api/v1/config` — system configuration
    - `GET /api/v1/health` — health check
    - _Requirements: 10.4, 13.1_

  - [x] 18.2 Wire full pipeline end-to-end
    - Connect Event Ingress → Evidence Collection → Root Cause Classifier → Sale Recovery Predictor → Demand Matching → Buyer Ranking → Decision Engine → Reallocation/Redelivery/Warehouse
    - Set up Redis Stream consumers for each pipeline stage
    - Integrate courier escalation checks post-classification
    - Integrate fraud detection checks pre-decision
    - Integrate event stream emission at each state transition
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 10.2_

- [x] 19. Checkpoint - Ensure full system integration works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Integration and load tests
  - [ ]* 20.1 Write integration tests for full pipeline
    - Test complete flow: event ingress → decision → execution
    - Test MongoDB queries with time-window filtering for evidence collection
    - Test geospatial queries for demand matching
    - Test Redis Streams pub/sub pipeline
    - Test API contract compliance for all Express routes
    - _Requirements: 10.1, 10.2, 11.2_

  - [ ]* 20.2 Write integration tests for ML API
    - Test FastAPI endpoints with mocked OpenAI and model inference
    - Test classification endpoint with various evidence payloads
    - Test recovery prediction endpoint with complete and partial data
    - _Requirements: 3.1, 4.1_

  - [ ]* 20.3 Write load test scripts
    - Create k6/artillery script for sustained 1000 events/second for 60 minutes
    - Create peak load test at 10x average throughput
    - Add latency assertions: p95 < 60s, p99 < 120s for full pipeline
    - Test buffer overflow behavior at 500K capacity
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

- [x] 21. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout implementation
- Property tests validate universal correctness properties from the design document (22 properties)
- The Python ML service communicates with the Node.js backend via HTTP (FastAPI endpoints)
- Redis Streams connects pipeline stages for async processing with buffering guarantees
- MongoDB geospatial indexes are critical for demand matching performance
- All configurable thresholds are externalized to environment variables for tuning

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1", "2.3", "3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3"] },
    { "id": 4, "tasks": ["5.1", "6.1", "7.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "6.2", "6.3", "7.2"] },
    { "id": 6, "tasks": ["5.4", "5.5", "6.4", "6.5", "7.3"] },
    { "id": 7, "tasks": ["5.6", "8.1"] },
    { "id": 8, "tasks": ["8.2", "8.3", "8.4", "9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3", "9.4"] },
    { "id": 10, "tasks": ["10.1", "10.2"] },
    { "id": 11, "tasks": ["10.3", "10.4", "10.5", "10.6"] },
    { "id": 12, "tasks": ["10.7", "10.8", "12.1"] },
    { "id": 13, "tasks": ["12.2", "12.3", "13.1"] },
    { "id": 14, "tasks": ["12.4", "12.5", "12.6", "12.7", "13.2", "13.3"] },
    { "id": 15, "tasks": ["14.1"] },
    { "id": 16, "tasks": ["14.2", "15.1"] },
    { "id": 17, "tasks": ["15.2", "15.3"] },
    { "id": 18, "tasks": ["15.4", "15.5"] },
    { "id": 19, "tasks": ["17.1", "18.1"] },
    { "id": 20, "tasks": ["17.2", "17.3", "17.4", "17.5", "18.2"] },
    { "id": 21, "tasks": ["20.1", "20.2", "20.3"] }
  ]
}
```
