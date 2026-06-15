# Requirements Document

## Introduction

The Flash Deal Eligibility Engine is a simulated AI decision engine that predicts whether an open-box returned product should be listed as a Hyperlocal Flash Deal. When a product is returned and passes inspection at a hub, the engine evaluates product features, condition data, demand signals, location context, and financial viability to produce a routing decision. The engine outputs a Flash Deal Score, a confidence level, and one of five possible dispositions. It also generates explainability artifacts showing which factors drove the decision. This is a hackathon demonstration that simulates a realistic ML decision experience without requiring actual ML training pipelines.

## Glossary

- **Flash_Deal_Engine**: The core AI decision service that evaluates returned products and produces eligibility scores, confidence ratings, and disposition decisions
- **Feature_Generator**: The module that generates simulated input feature vectors for a returned product including product attributes, condition metrics, demand signals, location data, and financial parameters
- **Analysis_Pipeline**: The sequential evaluation process that assesses a product across multiple dimensions (product, demand, condition, recovery value, buyer density, conversion probability) and produces animated progress feedback
- **Flash_Deal_Score**: A numerical score from 0 to 100 representing how suitable a product is for a hyperlocal flash deal listing
- **Confidence_Score**: A numerical score from 0 to 100 representing the engine's certainty in its disposition decision
- **Disposition_Decision**: One of five routing outcomes for a returned product: FLASH_DEAL, AMAZON_RENEWED, NORMAL_RESALE, CIRCULAR_ROUTING, or WAREHOUSE_RETURN
- **Explainability_Report**: A structured output showing positive factors, negative factors, and a natural-language explanation of why a particular disposition was chosen
- **Inspection_Grade**: A letter grade (A, B, C, D, F) assigned during product inspection representing overall product quality
- **Brand_Popularity_Score**: A numerical score from 0 to 100 representing the demand strength of a product's brand in the local market
- **Demand_Density**: A numerical score from 0 to 100 representing the concentration of potential buyers in a geographic area
- **Seed_Data**: Pre-configured demonstration datasets that showcase different product scenarios and decision outcomes for hackathon presentation purposes
- **Product_Passport**: The existing product lifecycle tracking record in the system that contains inspection history, condition data, and ownership chain
- **Business_Impact_Report**: A calculated breakdown showing traditional return costs versus flash deal route costs, savings amounts, warehouse touches avoided, and revenue recovery metrics
- **Sustainability_Report**: A calculated breakdown showing distance saved, CO2 emissions avoided, and products given second life compared to traditional return logistics
- **Score_Breakdown**: A detailed decomposition of the Flash_Deal_Score showing individual point contributions from each scoring dimension that sum to the total score

## Requirements

### Requirement 1: Input Feature Generation

**User Story:** As a demo presenter, I want the system to generate realistic input features for returned products, so that the AI evaluation has comprehensive data to analyze.

#### Acceptance Criteria

1. WHEN a flash deal evaluation is triggered for a returned product, THE Feature_Generator SHALL produce a complete feature vector containing: Product Features (Category, MRP, Current Market Price, Brand_Popularity_Score), Condition Features (Inspection_Grade with valid values A/B/C/D/F, Packaging Condition with valid values Original/Damaged/Missing, Damage Score 0-100, Battery Health percentage 0-100), Demand Features (Wishlist Count, Cart Count, Nearby Interested Buyers count, Historical Conversion Rate 0.0-1.0), Location Features (City, Demand_Density 0-100, Distance To Buyers in kilometers), and Financial Features (Expected Recovery Value in currency, Warehouse Cost Avoided in currency, Delivery Cost Saved in currency)
2. WHEN generating features from Seed_Data, THE Feature_Generator SHALL use pre-configured values that produce deterministic outcomes (identical Flash_Deal_Score, Confidence_Score, and Disposition_Decision on every run) for each seed scenario
3. WHEN generating features without Seed_Data, THE Feature_Generator SHALL produce randomized values within realistic bounds for each feature type: MRP between 500 and 150000, Current Market Price between 200 and 140000 (not exceeding MRP), Brand_Popularity_Score between 0 and 100, Damage Score between 0 and 100, Battery Health between 0 and 100, Wishlist Count between 0 and 500, Cart Count between 0 and 200, Nearby Interested Buyers between 0 and 50, Historical Conversion Rate between 0.0 and 1.0, Demand_Density between 0 and 100, Distance To Buyers between 0.5 and 100 kilometers, Expected Recovery Value between 100 and 140000, Warehouse Cost Avoided between 50 and 500, and Delivery Cost Saved between 20 and 300
4. THE Feature_Generator SHALL validate that all generated features fall within their defined bounds before passing them to the Analysis_Pipeline
5. IF a Product_Passport record exists for the returned product, THEN THE Feature_Generator SHALL extract Inspection_Grade and Battery Health from the most recent inspection in the Product_Passport inspection history
6. IF validation of any generated feature fails (value falls outside defined bounds), THEN THE Feature_Generator SHALL clamp the out-of-range value to the nearest bound, log the correction with the feature name, original value, and corrected value, and proceed with the corrected feature vector
7. IF a Product_Passport record exists but the most recent inspection is missing Inspection_Grade or Battery Health, THEN THE Feature_Generator SHALL generate the missing value using the randomized bounds defined for that feature type and flag the feature as synthetic in the feature vector metadata
8. THE Feature_Generator SHALL produce the complete validated feature vector within 2 seconds of evaluation trigger

### Requirement 2: AI Analysis Pipeline Execution

**User Story:** As a demo presenter, I want the system to display a sequential AI analysis process with animated progress, so that viewers experience a realistic ML inference workflow.

#### Acceptance Criteria

1. WHEN the Analysis_Pipeline receives a complete feature vector, THE Analysis_Pipeline SHALL execute six sequential evaluation stages in order: Analyzing Product, Evaluating Demand Signals, Evaluating Product Condition, Evaluating Recovery Value, Evaluating Buyer Density, Evaluating Conversion Probability
2. THE Analysis_Pipeline SHALL emit a progress event for each evaluation stage at intervals no greater than 200 milliseconds, with each event containing the stage name, stage index (1 through 6), and a completion percentage (integer from 0 to 100) that monotonically advances from 0 to 100 over the duration of that stage
3. WHEN the Analysis_Pipeline begins processing, THE Analysis_Pipeline SHALL provide a real-time event stream (via Server-Sent Events or WebSocket) to connected frontend clients, delivering each stage progress update within 100 milliseconds of its generation
4. THE Analysis_Pipeline SHALL complete all six stages within a total elapsed time of 3 to 8 seconds, with each individual stage taking between 500 milliseconds and 2000 milliseconds (configurable per stage)
5. IF the frontend client disconnects during pipeline execution, THEN THE Analysis_Pipeline SHALL continue processing to completion and store the final result for retrieval via a polling endpoint for a minimum of 5 minutes after completion
6. IF the Analysis_Pipeline receives an incomplete or malformed feature vector, THEN THE Analysis_Pipeline SHALL reject the request and return an error response indicating which required fields are missing or invalid, without initiating any evaluation stages

### Requirement 3: Score and Decision Computation

**User Story:** As a demo presenter, I want the engine to produce a Flash Deal Score, confidence rating, and disposition decision, so that the AI output is clear and actionable.

#### Acceptance Criteria

1. WHEN the Analysis_Pipeline completes all six evaluation stages, THE Flash_Deal_Engine SHALL compute a Flash_Deal_Score as an integer between 0 and 100 based on weighted contributions from: Condition Features (30% weight), Demand Features (30% weight), Financial Features (25% weight), and Location Features (15% weight), within 2 seconds of pipeline completion
2. WHEN the Flash_Deal_Engine computes the Flash_Deal_Score, it SHALL also compute a Confidence_Score as an integer between 0 and 100, where completeness is measured as the percentage of input features that have non-null values across all four feature categories, and consistency is measured as the degree to which individual feature category scores (each normalized to 0-100) fall within 25 points of the weighted Flash_Deal_Score
3. WHEN the Flash_Deal_Score and Confidence_Score are computed, THE Flash_Deal_Engine SHALL assign a Disposition_Decision using the following thresholds: FLASH_DEAL when Flash_Deal_Score is 75 or above and Confidence_Score is 60 or above, AMAZON_RENEWED when Flash_Deal_Score is between 50 and 74 and Inspection_Grade is A or B, NORMAL_RESALE when Flash_Deal_Score is between 30 and 74 and Inspection_Grade is C, D, or F, CIRCULAR_ROUTING when Flash_Deal_Score is between 15 and 29, WAREHOUSE_RETURN when Flash_Deal_Score is below 15 or Confidence_Score is below 30
4. THE Flash_Deal_Engine SHALL ensure that exactly one Disposition_Decision is assigned per evaluation (no product receives multiple dispositions)
5. IF multiple disposition rules match simultaneously, THEN THE Flash_Deal_Engine SHALL apply the following priority order: FLASH_DEAL (highest), AMAZON_RENEWED, NORMAL_RESALE, CIRCULAR_ROUTING, WAREHOUSE_RETURN (lowest)
6. IF the Analysis_Pipeline fails to complete one or more of the six evaluation stages, THEN THE Flash_Deal_Engine SHALL not compute a Flash_Deal_Score and SHALL return an error indication specifying which stages failed, without assigning a Disposition_Decision
7. WHEN assigning a Disposition_Decision, THE Flash_Deal_Engine SHALL record the Flash_Deal_Score, Confidence_Score, Inspection_Grade, the individual feature category scores, and the matched disposition rule for traceability

### Requirement 4: Explainability Report Generation

**User Story:** As a demo presenter, I want the engine to explain its decision with positive factors, negative factors, and a narrative explanation, so that viewers understand the AI reasoning.

#### Acceptance Criteria

1. WHEN a Disposition_Decision is produced, THE Flash_Deal_Engine SHALL generate an Explainability_Report containing: a list of top positive factors (up to 5 items), a list of top negative factors (up to 5 items), and a natural-language explanation paragraph of 2 to 4 sentences
2. THE Flash_Deal_Engine SHALL select positive factors from features that scored above the 70th percentile of their respective ranges and format each factor with a checkmark prefix (example: "✓ High Wishlist Activity")
3. THE Flash_Deal_Engine SHALL select negative factors from features that scored below the 30th percentile of their respective ranges and format each factor with a cross prefix (example: "✗ Low Margin")
4. THE Flash_Deal_Engine SHALL generate the natural-language explanation by referencing the Disposition_Decision, the top contributing positive factor, the primary risk factor, and the overall Flash_Deal_Score
5. WHEN the Explainability_Report is generated, THE Flash_Deal_Engine SHALL include it in the same response payload as the Flash_Deal_Score, Confidence_Score, and Disposition_Decision
6. IF fewer than 1 positive factor or fewer than 1 negative factor qualifies based on the percentile thresholds, THEN THE Flash_Deal_Engine SHALL select the single highest-scoring feature as a positive factor or the single lowest-scoring feature as a negative factor to ensure at least one factor appears in each list

### Requirement 5: Seed Data for Demonstrations

**User Story:** As a demo presenter, I want pre-configured seed scenarios that showcase different decision outcomes, so that I can demonstrate the full range of the engine's capabilities.

#### Acceptance Criteria

1. THE Feature_Generator SHALL provide a minimum of 5 seed product scenarios, with at least one scenario producing each of the five Disposition_Decision outcomes (FLASH_DEAL, AMAZON_RENEWED, NORMAL_RESALE, CIRCULAR_ROUTING, WAREHOUSE_RETURN)
2. WHEN a seed scenario is selected, THE Flash_Deal_Engine SHALL use the pre-configured feature values from that scenario and produce a deterministic output — identical score, confidence, decision, and explanation factors — on every execution given the same scenario input, regardless of system restarts or time of invocation
3. THE Feature_Generator SHALL include seed scenarios spanning at least 3 different product categories (Electronics, Fashion, Home Appliances) and at least 3 different cities
4. WHEN the backend starts with the DEMO_MODE environment variable set to "true" or "1", THE Flash_Deal_Engine SHALL pre-load all seed scenarios into the database within 30 seconds of startup and make them available via a list endpoint that returns all scenarios; IF seed data already exists from a previous startup, THEN THE Flash_Deal_Engine SHALL replace it with a fresh copy to ensure idempotent behavior
5. THE Feature_Generator SHALL store each seed scenario with a human-readable name of no more than 100 characters (example: "Premium Smartphone - Excellent Condition") and a description of no more than 500 characters explaining why that scenario produces its particular decision outcome

### Requirement 6: REST API Integration

**User Story:** As a frontend developer, I want well-defined API endpoints for triggering evaluations and retrieving results, so that the UI can integrate with the engine.

#### Acceptance Criteria

1. THE Flash_Deal_Engine SHALL expose a POST endpoint at /api/v1/flash-deals/evaluate that accepts a product identifier (maximum 128 characters) or a complete feature vector and returns an evaluation ID with initial status "processing" within 2 seconds of request receipt
2. THE Flash_Deal_Engine SHALL expose a GET endpoint at /api/v1/flash-deals/evaluations/:id that returns the current evaluation status (one of: "processing", "completed", "failed"), and when status is "completed", the full result including Flash_Deal_Score, Confidence_Score, Disposition_Decision, and Explainability_Report
3. THE Flash_Deal_Engine SHALL expose a GET endpoint at /api/v1/flash-deals/seed-scenarios that returns the list of available seed scenarios with their names, descriptions, and product categories
4. THE Flash_Deal_Engine SHALL expose a POST endpoint at /api/v1/flash-deals/evaluate/seed/:scenarioId that triggers evaluation using a specific seed scenario's pre-configured features and returns an evaluation ID with initial status "processing" within 2 seconds of request receipt
5. THE Flash_Deal_Engine SHALL expose a GET endpoint at /api/v1/flash-deals/evaluations/:id/stream that provides Server-Sent Events for real-time pipeline progress updates during an active evaluation, and SHALL close the connection when the evaluation reaches "completed" or "failed" status or after a maximum of 120 seconds of inactivity
6. IF an evaluation request references a product identifier that does not exist in the system, THEN THE Flash_Deal_Engine SHALL return a 404 response with an error message indicating the missing product identifier
7. IF a POST request to /api/v1/flash-deals/evaluate contains neither a valid product identifier nor a complete feature vector, THEN THE Flash_Deal_Engine SHALL return a 400 response with an error message indicating the missing or malformed fields
8. IF a POST request to /api/v1/flash-deals/evaluate/seed/:scenarioId references a scenarioId that does not exist, THEN THE Flash_Deal_Engine SHALL return a 404 response with an error message indicating the unknown scenario identifier
9. IF a GET request to /api/v1/flash-deals/evaluations/:id references an evaluation ID that does not exist, THEN THE Flash_Deal_Engine SHALL return a 404 response with an error message indicating the unknown evaluation identifier

### Requirement 7: Evaluation Persistence and History

**User Story:** As a demo presenter, I want previous evaluations stored and retrievable, so that I can show evaluation history and compare outcomes across products.

#### Acceptance Criteria

1. WHEN an evaluation completes, THE Flash_Deal_Engine SHALL persist the full evaluation record including: evaluation ID, product identifier, input feature vector, all six stage results, Flash_Deal_Score, Confidence_Score, Disposition_Decision, Explainability_Report, and timestamps for start and completion
2. THE Flash_Deal_Engine SHALL expose a GET endpoint at /api/v1/flash-deals/evaluations that returns a paginated list of past evaluations sorted by most recent first, supporting optional filters by Disposition_Decision and product category, with page size defaulting to 20 and maximum of 100
3. THE Flash_Deal_Engine SHALL retain all evaluation records for the lifetime of the demonstration deployment (no automatic deletion)
4. WHEN retrieving evaluation history, THE Flash_Deal_Engine SHALL return results within 2 seconds for up to 1000 stored evaluations
5. IF persistence of an evaluation record fails, THEN THE Flash_Deal_Engine SHALL retry once and, if the retry fails, log the failure with the evaluation ID and continue without blocking the evaluation response to the client

### Requirement 8: Frontend Display Integration

**User Story:** As a frontend developer, I want structured data suitable for rendering the AI analysis panel, feature cards, and decision output, so that the UI presents a polished demo experience.

#### Acceptance Criteria

1. THE Flash_Deal_Engine SHALL structure the evaluation response payload with distinct sections: inputFeatures (grouped by category: product, condition, demand, location, financial), pipelineProgress (array of 6 stage objects with name, status using values from the set pending/in_progress/completed, and duration in milliseconds), result (Flash_Deal_Score, Confidence_Score, Disposition_Decision), and explainability (positiveFactors array, negativeFactors array, explanation text)
2. WHEN emitting pipeline progress events via SSE, THE Flash_Deal_Engine SHALL format each event with an SSE event type of "pipeline_progress" and a JSON data payload containing fields: stage (string), stageIndex (number 1-6), progress (number 0-100), and status (one of: pending, in_progress, completed)
3. THE Flash_Deal_Engine SHALL include for each input feature in the inputFeatures section: the feature's computed value, a display-friendly label of no more than 50 characters (example: "Brand Popularity Score" for Brand_Popularity_Score, "Distance To Buyers (km)" for distanceToBuyers), and the feature's unit of measurement where applicable
4. THE Flash_Deal_Engine SHALL include a color mapping for each Disposition_Decision in the response: FLASH_DEAL maps to green, AMAZON_RENEWED maps to blue, NORMAL_RESALE maps to amber, CIRCULAR_ROUTING maps to purple, WAREHOUSE_RETURN maps to red
5. IF the Analysis_Pipeline fails during any evaluation stage, THEN THE Flash_Deal_Engine SHALL return a response payload containing: the last successfully completed stage index, the failed stage name, an error indication describing the failure category, and any partial results computed before the failure

### Requirement 9: Business Impact Calculation

**User Story:** As a demo presenter, I want every evaluation to show concrete cost savings and revenue recovery metrics, so that judges can immediately see the financial value of the flash deal approach.

#### Acceptance Criteria

1. WHEN an evaluation completes, THE Flash_Deal_Engine SHALL calculate and include a business impact breakdown containing: Traditional Return Cost (in INR, rounded to 2 decimal places), Flash Deal Route Cost (in INR, rounded to 2 decimal places), Savings Amount (Traditional Return Cost minus Flash Deal Route Cost), and Cost Reduction Percentage (rounded to 1 decimal place)
2. WHEN an evaluation completes, THE Flash_Deal_Engine SHALL calculate and include operational metrics: Warehouse Touches Avoided (integer count representing the number of hub/warehouse processing steps eliminated), Estimated Recovery Value (in INR, computed as Current Market Price multiplied by the Inspection_Grade depreciation factor where Grade A = 1.0, Grade B = 0.85, Grade C = 0.70, Grade D = 0.50), and Revenue Recovery Rate (percentage of MRP recovered, computed as the deal price offered to the matched buyer divided by MRP, multiplied by 100)
3. THE Flash_Deal_Engine SHALL compute Traditional Return Cost using: reverse pickup cost plus hub processing cost plus warehouse inbound cost plus re-listing cost, with configurable per-unit defaults (reverse pickup: 120 INR, hub processing: 80 INR, warehouse inbound: 90 INR, re-listing: 100 INR)
4. THE Flash_Deal_Engine SHALL compute Flash Deal Route Cost using: local delivery cost plus inspection cost, with configurable per-unit defaults (local delivery: 120 INR, inspection: 50 INR)
5. THE Flash_Deal_Engine SHALL expose a GET endpoint at /api/v1/flash-deals/impact/aggregate that returns cumulative business impact totals across all completed evaluations within 2 seconds: total savings (in INR), average cost reduction percentage, total revenue recovered (in INR), and average recovery rate (percentage)
6. IF Current Market Price or Inspection_Grade is unavailable for an evaluation, THEN THE Flash_Deal_Engine SHALL omit Estimated Recovery Value and Revenue Recovery Rate from the business impact breakdown for that evaluation and include a field indicating which inputs were missing
7. IF no completed evaluations exist when the aggregate endpoint is queried, THEN THE Flash_Deal_Engine SHALL return all aggregate totals as zero

### Requirement 10: Sustainability Impact

**User Story:** As a demo presenter, I want every evaluation to display environmental impact metrics, so that the sustainability benefits of flash deals are immediately visible to judges.

#### Acceptance Criteria

1. WHEN an evaluation completes, THE Flash_Deal_Engine SHALL calculate and include sustainability metrics in the evaluation response payload: Traditional Distance in kilometers (distance to warehouse and back to a future buyer), Flash Deal Distance in kilometers (direct local delivery to nearby buyer), Distance Saved in kilometers (computed as Traditional Distance minus Flash Deal Distance), and CO2 Saved in kilograms (computed as Distance Saved multiplied by a configurable emission factor, default: 0.027 kg CO2 per kilometer for last-mile delivery), with all values rounded to 2 decimal places
2. THE Flash_Deal_Engine SHALL compute Traditional Distance as: Distance To Buyers (from Location Features) plus average warehouse return distance (configurable default: 100 km round-trip to warehouse)
3. THE Flash_Deal_Engine SHALL compute Flash Deal Distance as the Distance To Buyers value from the Location Features
4. THE Flash_Deal_Engine SHALL expose cumulative sustainability totals via the /api/v1/flash-deals/impact/aggregate endpoint including: total CO2 saved in kilograms, total distance avoided in kilometers, total products given second life (count of evaluations with Disposition_Decision other than WAREHOUSE_RETURN), and total evaluations processed, returning results within 2 seconds for up to 1000 stored evaluations
5. WHEN the Disposition_Decision is WAREHOUSE_RETURN, THE Flash_Deal_Engine SHALL report sustainability metrics as zero savings (Traditional Distance: 0, Flash Deal Distance: 0, Distance Saved: 0, CO2 Saved: 0) since the product follows the traditional return path and provides no environmental benefit relative to the baseline

### Requirement 11: Score Contribution Breakdown

**User Story:** As a demo presenter, I want the Flash Deal Score broken down into individual factor contributions, so that the decision appears as an explainable AI console rather than a black box.

#### Acceptance Criteria

1. WHEN the Flash_Deal_Score is computed, THE Flash_Deal_Engine SHALL produce a score contributors breakdown showing the individual point contribution from each scoring dimension: Condition Grade (points contributed out of 30 maximum, derived from the Condition Features weight), Local Demand (points contributed out of 15 maximum, derived from a portion of the Demand Features weight), Wishlist Activity (points contributed out of 15 maximum, derived from the remaining portion of the Demand Features weight), Margin Potential (points contributed out of 25 maximum, derived from the Financial Features weight), and Buyer Density (points contributed out of 15 maximum, derived from the Location Features weight)
2. THE Flash_Deal_Engine SHALL format each score contributor as a labeled entry containing three fields: the contributor name (string), the points contributed (integer from 0 to that contributor's maximum), and the maximum possible points for that contributor (integer)
3. THE Flash_Deal_Engine SHALL order score contributors from highest points-contributed value to lowest points-contributed value in the response payload; IF two or more contributors have equal points contributed, THEN THE Flash_Deal_Engine SHALL order them alphabetically by contributor name
4. THE Flash_Deal_Engine SHALL ensure that the sum of all individual contributor points equals the final Flash_Deal_Score (the five contributor maximums sum to 100, and contributor points account for 100 percent of the total score with no remainder or rounding loss)
5. THE Flash_Deal_Engine SHALL include the score contributors breakdown in the evaluation response payload alongside the Explainability_Report under a dedicated "scoreBreakdown" field as an ordered array of contributor objects

### Requirement 12: Product Passport Integration

**User Story:** As a demo presenter, I want every flash deal evaluation to create timeline events inside the Product Passport, so that the feature feels integrated into the product lifecycle ecosystem rather than being a standalone tool.

#### Acceptance Criteria

1. WHEN a flash deal evaluation is triggered for a product with an existing Product_Passport, THE Flash_Deal_Engine SHALL append a "Flash Deal Evaluation Started" event to the Product_Passport routing history with timestamp in ISO 8601 format, details containing the evaluation ID, and status "active"
2. WHEN the Analysis_Pipeline completes all six stages, THE Flash_Deal_Engine SHALL append an "AI Analysis Complete" event to the Product_Passport routing history with timestamp in ISO 8601 format, details containing the Flash_Deal_Score and the Disposition_Decision, and status "completed"
3. WHEN the Disposition_Decision is FLASH_DEAL, THE Flash_Deal_Engine SHALL append a "Flash Deal Eligible" event to the Product_Passport routing history with timestamp in ISO 8601 format, details containing the Flash_Deal_Score, and status "completed"
4. IF the Disposition_Decision is FLASH_DEAL and the Demand Features Nearby Interested Buyers count is greater than zero, THEN THE Flash_Deal_Engine SHALL append a "Buyer Reserved" event to the Product_Passport routing history with timestamp in ISO 8601 format, details containing the buyer city and distance, and status "pending"
5. WHEN the Disposition_Decision is not FLASH_DEAL, THE Flash_Deal_Engine SHALL append a routing history event with the event name formatted as "Routed to" followed by the disposition display label (AMAZON_RENEWED displays as "Amazon Renewed", NORMAL_RESALE displays as "Normal Resale", CIRCULAR_ROUTING displays as "Circular Routing", WAREHOUSE_RETURN displays as "Warehouse Return") with timestamp in ISO 8601 format and status "completed"
6. IF no Product_Passport record exists for the evaluated product, THEN THE Flash_Deal_Engine SHALL create a new Product_Passport record populated with sku, productName, and category from the feature vector Product Features, condition derived from Inspection_Grade (A maps to "like_new", B maps to "good", C maps to "fair", D or F maps to "fair"), currentStatus set to "at_hub", and an initial routing history containing all evaluation events generated during the current evaluation
7. IF the Product_Passport record creation or update fails, THEN THE Flash_Deal_Engine SHALL complete the evaluation normally, return the evaluation result to the caller, and log the passport update failure without blocking the evaluation response
