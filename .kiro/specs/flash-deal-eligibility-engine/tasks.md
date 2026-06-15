# Implementation Plan: Flash Deal Eligibility Engine

## Overview

Build a deterministic scoring engine that evaluates open-box returned products for hyperlocal flash deal eligibility. Implementation follows a bottom-up approach: data models and config first, then core computation services (feature generation, scoring, disposition), then the orchestrating pipeline with SSE streaming, then the REST API layer, then Product Passport integration, and finally seed data loading.

## Tasks

- [x] 1. Set up data models, config, and project structure
  - [x] 1.1 Create FlashDealEvaluation Mongoose model
    - Create `backend/src/models/FlashDealEvaluation.ts` with the IFlashDealEvaluation interface and Mongoose schema
    - Include all fields: evaluationId, productId, scenarioId, status, inputFeatures, pipelineStages, result, explainability, scoreBreakdown, businessImpact, sustainability, timestamps, error
    - Add indexes: unique on evaluationId, compound on status+createdAt, on dispositionDecision+createdAt, on product category+createdAt, on productId
    - Export the model and register in `backend/src/models/index.ts`
    - _Requirements: 7.1, 7.3_

  - [x] 1.2 Create FlashDealSeedScenario Mongoose model
    - Create `backend/src/models/FlashDealSeedScenario.ts` with the IFlashDealSeedScenario interface and Mongoose schema
    - Include fields: scenarioId, name (maxlength 100), description (maxlength 500), category, city, features (FeatureVector), expectedDecision
    - Add unique index on scenarioId
    - Export the model and register in `backend/src/models/index.ts`
    - _Requirements: 5.1, 5.5_

  - [x] 1.3 Add flash deal configuration to config module
    - Extend `backend/src/config/index.ts` with flash deal config values: pipeline stage durations, cost defaults (reverse pickup 120, hub processing 80, warehouse inbound 90, re-listing 100, local delivery 120, inspection 50), sustainability defaults (warehouse return distance 100km, emission factor 0.027), score weights, demo mode flag
    - _Requirements: 2.4, 9.3, 9.4, 10.1, 10.2_

  - [x] 1.4 Create shared TypeScript interfaces and types
    - Create `backend/src/services/flashDeal/types.ts` with all shared interfaces: FeatureVector, ProductFeatures, ConditionFeatures, DemandFeatures, LocationFeatures, FinancialFeatures, CategoryScores, ScoreWeights, DispositionDecision type, PipelineStage, ScoreContributor, Factor, ExplainabilityReport, BusinessImpact, SustainabilityMetrics, PipelineProgressEvent
    - _Requirements: 1.1, 3.1, 8.1_

- [x] 2. Implement Feature Generator service
  - [x] 2.1 Implement Feature Generator core logic
    - Create `backend/src/services/flashDeal/featureGenerator.ts`
    - Implement `generateRandom()` producing randomized features within all defined bounds
    - Implement `generateFromSeed(scenarioId)` returning pre-configured deterministic features
    - Implement `generateFromPassport(passportId)` extracting inspection grade and battery health from the most recent inspection, generating remaining features within bounds
    - Implement `validate(features)` checking all bounds and required fields
    - Implement `clampToRange(value, min, max, fieldName)` with logging on correction
    - Ensure currentMarketPrice never exceeds MRP
    - Flag synthetic fields in metadata when values are generated due to missing passport data
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ]* 2.2 Write property test for feature vector bounds (Property 1)
    - **Property 1: Feature Vector Completeness and Bounds**
    - Use fast-check to generate arbitrary feature vectors via `generateRandom()` and verify all numeric fields fall within defined bounds and currentMarketPrice ≤ MRP
    - **Validates: Requirements 1.1, 1.3, 1.4**

  - [ ]* 2.3 Write property test for feature clamping (Property 2)
    - **Property 2: Feature Validation Clamping**
    - Use fast-check to generate out-of-range values and verify `clampToRange` always produces values within [min, max]
    - **Validates: Requirements 1.4, 1.6**

  - [ ]* 2.4 Write property test for malformed feature rejection (Property 3)
    - **Property 3: Malformed Feature Vector Rejection**
    - Use fast-check to generate feature vectors with randomly removed required fields and verify validate() returns errors identifying all missing fields
    - **Validates: Requirements 2.6**

- [x] 3. Implement Score Calculator service
  - [x] 3.1 Implement Score Calculator
    - Create `backend/src/services/flashDeal/scoreCalculator.ts`
    - Implement `normalizeCategoryScore()` to normalize raw feature values to 0–100 for each category (condition, demand, financial, location)
    - Implement `computeScore()` applying weights (condition 0.30, demand 0.30, financial 0.25, location 0.15) and rounding to integer
    - Implement `computeConfidence()` based on feature completeness and category score consistency (deviation > 25 from weighted score reduces confidence)
    - Return ScoreResult with flashDealScore, confidenceScore, categoryScores, weights
    - _Requirements: 3.1, 3.2, 3.7_

  - [ ]* 3.2 Write property test for weighted score computation (Property 4)
    - **Property 4: Flash Deal Score Weighted Computation**
    - Use fast-check to generate random category scores 0–100, compute weighted sum, verify result is integer in [0, 100] matching the formula
    - **Validates: Requirements 3.1**

  - [ ]* 3.3 Write property test for confidence score (Property 5)
    - **Property 5: Confidence Score Computation**
    - Use fast-check to verify confidence is integer in [0, 100], increases with completeness, decreases with high category score deviation
    - **Validates: Requirements 3.2**

- [x] 4. Implement Disposition Decider service
  - [x] 4.1 Implement Disposition Decider
    - Create `backend/src/services/flashDeal/dispositionDecider.ts`
    - Implement priority-ordered rules: FLASH_DEAL (score≥75 AND confidence≥60), AMAZON_RENEWED (50≤score≤74 AND grade A/B), NORMAL_RESALE (30≤score≤74 AND grade C/D/F), CIRCULAR_ROUTING (15≤score≤29), WAREHOUSE_RETURN (score<15 OR confidence<30)
    - Implement `getColorMapping()` and `getDisplayLabel()` helpers
    - Return DispositionResult with decision, matchedRule description, score, confidence, grade
    - _Requirements: 3.3, 3.4, 3.5, 8.4_

  - [ ]* 4.2 Write property test for disposition uniqueness and priority (Property 6)
    - **Property 6: Disposition Assignment Uniqueness and Priority**
    - Use fast-check to generate all combinations of score (0–100), confidence (0–100), grade (A/B/C/D/F) and verify exactly one disposition is assigned following priority order
    - **Validates: Requirements 3.3, 3.4, 3.5**

  - [ ]* 4.3 Write property test for disposition label mapping (Property 14)
    - **Property 14: Disposition Display Label Mapping**
    - Use fast-check to verify non-FLASH_DEAL dispositions produce correct "Routed to {label}" event names
    - **Validates: Requirements 12.5**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Explainability Reporter service
  - [x] 6.1 Implement Explainability Reporter
    - Create `backend/src/services/flashDeal/explainabilityReporter.ts`
    - Implement `computePercentile(value, min, max)` returning position within range as 0–100
    - Implement `generateReport()` selecting 1–5 positive factors (>70th percentile, "✓" prefix) and 1–5 negative factors (<30th percentile, "✗" prefix)
    - Implement fallback: if fewer than 1 qualifies, select single highest/lowest scoring feature
    - Implement `generateExplanation()` producing 2–4 sentence paragraph referencing disposition, top positive factor, primary risk, and score
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 6.2 Write property test for factor selection (Property 7)
    - **Property 7: Explainability Factor Selection**
    - Use fast-check to generate feature vectors and verify positive factors are from >70th percentile, negative from <30th percentile, each list has 1–5 items, correct prefixes
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.6**

  - [ ]* 6.3 Write property test for explanation text (Property 8)
    - **Property 8: Explanation Text Completeness**
    - Use fast-check to verify explanation is 2–4 sentences and references disposition name, top positive factor, primary risk factor, and Flash Deal Score
    - **Validates: Requirements 4.4**

- [x] 7. Implement Score Breakdown Generator service
  - [x] 7.1 Implement Score Breakdown Generator
    - Create `backend/src/services/flashDeal/scoreBreakdownGenerator.ts`
    - Define contributor maximums: Condition Grade 30, Local Demand 15, Wishlist Activity 15, Margin Potential 25, Buyer Density 15
    - Implement `generateBreakdown()` computing raw points per contributor from category scores and features
    - Implement `distributePoints()` ensuring sum equals flashDealScore exactly (adjust largest contributor for rounding)
    - Order contributors from highest to lowest points; alphabetical for ties
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 7.2 Write property test for score breakdown sum invariant (Property 12)
    - **Property 12: Score Breakdown Sum Invariant**
    - Use fast-check to generate scores and verify 5 contributors, each within [0, max], and sum equals flashDealScore exactly
    - **Validates: Requirements 11.1, 11.2, 11.4**

  - [ ]* 7.3 Write property test for score breakdown ordering (Property 13)
    - **Property 13: Score Breakdown Ordering**
    - Use fast-check to verify contributors are ordered highest-to-lowest, with alphabetical tiebreaker
    - **Validates: Requirements 11.3**

- [x] 8. Implement Business Impact and Sustainability calculators
  - [x] 8.1 Implement Business Impact Calculator
    - Create `backend/src/services/flashDeal/businessImpactCalculator.ts`
    - Implement `calculate(features, config?)` computing: traditionalReturnCost (sum of reverse pickup + hub processing + warehouse inbound + re-listing), flashDealRouteCost (local delivery + inspection), savingsAmount, costReductionPercentage
    - Compute warehouseTouchesAvoided, estimatedRecoveryValue (currentMarketPrice × grade depreciation), revenueRecoveryRate
    - Handle missing inputs: omit recovery/revenue fields, include missingInputs array
    - Implement `calculateAggregate()` for cumulative totals across all completed evaluations
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 8.2 Implement Sustainability Calculator
    - Create `backend/src/services/flashDeal/sustainabilityCalculator.ts`
    - Implement `calculate(distanceToBuyers, disposition, config?)`: traditionalDistance = distanceToBuyers + warehouseReturnDistance, flashDealDistance = distanceToBuyers, distanceSaved, co2Saved = distanceSaved × emissionFactor
    - For WAREHOUSE_RETURN: all metrics are zero
    - All values rounded to 2 decimal places
    - Implement `calculateAggregate()` for cumulative sustainability totals
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 8.3 Write property test for business impact arithmetic (Property 9)
    - **Property 9: Business Impact Arithmetic**
    - Use fast-check to generate random cost config values and verify: traditional = sum of 4 costs, flash = sum of 2 costs, savings = traditional - flash, percentage = (savings/traditional)×100
    - **Validates: Requirements 9.1, 9.3, 9.4**

  - [ ]* 8.4 Write property test for recovery value calculation (Property 10)
    - **Property 10: Recovery Value Calculation**
    - Use fast-check to generate market prices and grades, verify recovery = price × depreciation factor, rounded to 2 decimal places
    - **Validates: Requirements 9.2**

  - [ ]* 8.5 Write property test for sustainability calculations (Property 11)
    - **Property 11: Sustainability Distance and CO2 Calculation**
    - Use fast-check to verify distance/CO2 formulas for non-WAREHOUSE_RETURN dispositions and zero metrics for WAREHOUSE_RETURN
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.5**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement Analysis Pipeline with SSE streaming
  - [x] 10.1 Implement Analysis Pipeline service
    - Create `backend/src/services/flashDeal/analysisPipeline.ts`
    - Implement `execute(evaluationId, features)` running 6 sequential stages with configurable timing (500–2000ms each, 3–8s total)
    - Each stage computes a categoryScore (0–100) and identifies key factors from the feature vector
    - Validate feature vector completeness before starting; reject with missing field list if invalid
    - Publish progress events to Redis channel `flash-deal:${evaluationId}` at ≤200ms intervals
    - Store final result in Redis with 5-minute TTL for polling after client disconnect
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 10.2 Write unit tests for Analysis Pipeline
    - Test stage execution order and count
    - Test progress event emission format
    - Test rejection of incomplete feature vectors
    - Test timing constraints (each stage 500–2000ms)
    - _Requirements: 2.1, 2.2, 2.4, 2.6_

- [x] 11. Implement Product Passport Integration service
  - [x] 11.1 Implement Passport Integration service
    - Create `backend/src/services/flashDeal/passportIntegration.ts`
    - Implement `appendEvaluationStarted(passportId, evaluationId)` adding "Flash Deal Evaluation Started" event
    - Implement `appendAnalysisComplete(passportId, score, decision)` adding "AI Analysis Complete" event
    - Implement `appendDispositionEvent(passportId, decision, details)`: "Flash Deal Eligible" for FLASH_DEAL, "Routed to {label}" for others
    - Implement `appendBuyerReserved(passportId, buyerCity, distance)` if nearbyInterestedBuyers > 0
    - Implement `createPassportIfNotExists(features, evaluationEvents)` creating a new ProductPassport with condition mapping (A→like_new, B→good, C/D/F→fair)
    - Handle passport update failures gracefully (log and continue)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ]* 11.2 Write unit tests for Passport Integration
    - Test event creation format for each disposition
    - Test passport creation with grade-to-condition mapping
    - Test graceful failure handling
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6_

- [x] 12. Implement REST API routes
  - [x] 12.1 Create flash deal router and evaluation orchestration
    - Create `backend/src/routes/flashDeals.ts`
    - Implement POST `/api/v1/flash-deals/evaluate`: accept productId or featureVector, create evaluation record (status: processing), return 202 with evaluationId, kick off async pipeline execution orchestrating all services (feature generation → pipeline → scoring → disposition → explainability → breakdown → impact → sustainability → passport integration → persist)
    - Implement POST `/api/v1/flash-deals/evaluate/seed/:scenarioId`: lookup seed scenario, trigger evaluation with pre-configured features
    - Handle errors: 400 for missing input, 404 for unknown product/scenario, 500 for unexpected failures
    - _Requirements: 6.1, 6.4, 6.6, 6.7, 6.8_

  - [x] 12.2 Implement SSE stream and status endpoints
    - Implement GET `/api/v1/flash-deals/evaluations/:id/stream`: subscribe to Redis channel `flash-deal:${id}`, emit SSE events with type "pipeline_progress" and JSON data payload (stage, stageIndex, progress, status), close on completion/failure or 120s timeout
    - Implement GET `/api/v1/flash-deals/evaluations/:id`: return full evaluation record, 404 if not found
    - _Requirements: 6.2, 6.5, 6.9, 8.1, 8.2_

  - [x] 12.3 Implement list, seed-scenarios, and aggregate endpoints
    - Implement GET `/api/v1/flash-deals/evaluations`: paginated list (default page size 20, max 100), sorted by most recent, filterable by disposition and category
    - Implement GET `/api/v1/flash-deals/seed-scenarios`: return all seed scenarios with names, descriptions, categories
    - Implement GET `/api/v1/flash-deals/impact/aggregate`: return cumulative business impact + sustainability totals across all completed evaluations
    - _Requirements: 6.3, 7.2, 7.4, 9.5, 9.7, 10.4_

  - [x] 12.4 Register flash deals router in Express app
    - Import and mount the flash deals router at `/api/v1/flash-deals` in `backend/src/index.ts`
    - _Requirements: 6.1_

  - [ ]* 12.5 Write integration tests for API endpoints
    - Test POST /evaluate with feature vector returns 202
    - Test POST /evaluate/seed/:id returns 202
    - Test GET /evaluations/:id returns result after completion
    - Test GET /evaluations with pagination and filters
    - Test GET /seed-scenarios returns scenario list
    - Test GET /impact/aggregate returns totals
    - Test 400/404 error responses
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 6.9_

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement seed data loading
  - [x] 14.1 Create seed data loader
    - Create `backend/src/demo/seedFlashDeals.ts`
    - Define 5 seed scenarios covering all dispositions: Premium Smartphone (Electronics/Mumbai/A/88→FLASH_DEAL), Designer Jacket (Fashion/Delhi/B/62→AMAZON_RENEWED), Bluetooth Speaker (Electronics/Bangalore/C/45→NORMAL_RESALE), Kitchen Mixer (Home Appliances/Hyderabad/D/22→CIRCULAR_ROUTING), Budget Earbuds (Electronics/Chennai/F/8→WAREHOUSE_RETURN)
    - Implement idempotent seed loading: delete existing seed data, insert fresh copies
    - Integrate into `autoSeedIfDemoMode()` in `backend/src/demo/autoSeed.ts` so seeds load when DEMO_MODE=true
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 14.2 Write unit tests for seed data
    - Verify all 5 dispositions covered
    - Verify at least 3 categories and 3 cities
    - Verify names ≤ 100 chars, descriptions ≤ 500 chars
    - Run each seed through the scoring pipeline 3 times and verify deterministic outputs
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check (already in devDependencies)
- Unit tests validate specific examples and edge cases using vitest
- All services are placed under `backend/src/services/flashDeal/` to namespace the feature
- The pipeline orchestration in the route handler coordinates all services in sequence
- Redis is used for SSE pub/sub and short-lived evaluation status caching (5 min TTL)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.2", "4.3", "6.1", "7.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "7.2", "7.3", "8.1", "8.2"] },
    { "id": 5, "tasks": ["8.3", "8.4", "8.5", "10.1"] },
    { "id": 6, "tasks": ["10.2", "11.1"] },
    { "id": 7, "tasks": ["11.2", "12.1"] },
    { "id": 8, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 9, "tasks": ["12.5", "14.1"] },
    { "id": 10, "tasks": ["14.2"] }
  ]
}
```
