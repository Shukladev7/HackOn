# RTO Reallocation Engine

AI-powered In-Transit Inventory Reallocation Engine that intercepts RTO (Return-To-Origin) shipments and determines optimal next actions: redeliver, reallocate to a nearby buyer, or return to warehouse.

## Project Structure

```
HackOn/
├── .env.example
├── .gitignore
├── .kiro/
│   └── specs/
│       ├── flash-deal-eligibility-engine/
│       │   ├── .config.kiro
│       │   ├── design.md
│       │   ├── requirements.md
│       │   └── tasks.md
│       └── rto-reallocation-engine/
│           ├── .config.kiro
│           ├── design.md
│           ├── requirements.md
│           └── tasks.md
├── README.md
├── backend/
│   ├── .eslintrc.js
│   ├── package-lock.json
│   ├── package.json
│   ├── src/
│   │   ├── config/
│   │   │   ├── index.test.ts
│   │   │   └── index.ts
│   │   ├── demo/
│   │   │   ├── autoSeed.ts
│   │   │   ├── scenarios.ts
│   │   │   ├── seed.ts
│   │   │   ├── seedFlashDeals.ts
│   │   │   └── seedPassports.ts
│   │   ├── index.test.ts
│   │   ├── index.ts
│   │   ├── models/
│   │   │   ├── .gitkeep
│   │   │   ├── Courier.ts
│   │   │   ├── Customer.ts
│   │   │   ├── DecisionRecord.ts
│   │   │   ├── DeliveryAttempt.ts
│   │   │   ├── EventStream.ts
│   │   │   ├── EvidenceStore.ts
│   │   │   ├── FlashDealEvaluation.ts
│   │   │   ├── FlashDealSeedScenario.ts
│   │   │   ├── HubEvent.ts
│   │   │   ├── Order.ts
│   │   │   ├── ProductPassport.ts
│   │   │   ├── RTOEvent.ts
│   │   │   ├── ReallocationEvent.ts
│   │   │   ├── index.ts
│   │   │   ├── indexes.test.ts
│   │   │   └── indexes.ts
│   │   ├── routes/
│   │   │   ├── .gitkeep
│   │   │   ├── configRoutes.ts
│   │   │   ├── couriers.ts
│   │   │   ├── demo.ts
│   │   │   ├── flashDeals.ts
│   │   │   ├── metrics.test.ts
│   │   │   ├── metrics.ts
│   │   │   ├── orders.ts
│   │   │   ├── packages.ts
│   │   │   ├── passport.ts
│   │   │   ├── routes.test.ts
│   │   │   ├── rtoEventDetails.ts
│   │   │   └── rtoEvents.ts
│   │   ├── services/
│   │   │   ├── .gitkeep
│   │   │   ├── buyerRanking.test.ts
│   │   │   ├── buyerRanking.ts
│   │   │   ├── courierEscalation.test.ts
│   │   │   ├── courierEscalation.ts
│   │   │   ├── decisionEngine.test.ts
│   │   │   ├── decisionEngine.ts
│   │   │   ├── demandMatching.findCandidates.test.ts
│   │   │   ├── demandMatching.test.ts
│   │   │   ├── demandMatching.ts
│   │   │   ├── eventBufferManager.test.ts
│   │   │   ├── eventBufferManager.ts
│   │   │   ├── eventIngress.test.ts
│   │   │   ├── eventIngress.ts
│   │   │   ├── eventStream.test.ts
│   │   │   ├── eventStream.ts
│   │   │   ├── evidenceCollection.collectEvidence.test.ts
│   │   │   ├── evidenceCollection.test.ts
│   │   │   ├── evidenceCollection.ts
│   │   │   ├── evidenceNormalization.test.ts
│   │   │   ├── flashDeal/
│   │   │   │   ├── analysisPipeline.ts
│   │   │   │   ├── businessImpactCalculator.test.ts
│   │   │   │   ├── businessImpactCalculator.ts
│   │   │   │   ├── dispositionDecider.test.ts
│   │   │   │   ├── dispositionDecider.ts
│   │   │   │   ├── explainabilityReporter.test.ts
│   │   │   │   ├── explainabilityReporter.ts
│   │   │   │   ├── featureGenerator.test.ts
│   │   │   │   ├── featureGenerator.ts
│   │   │   │   ├── passportIntegration.test.ts
│   │   │   │   ├── passportIntegration.ts
│   │   │   │   ├── scoreBreakdownGenerator.test.ts
│   │   │   │   ├── scoreBreakdownGenerator.ts
│   │   │   │   ├── scoreCalculator.test.ts
│   │   │   │   ├── scoreCalculator.ts
│   │   │   │   ├── sustainabilityCalculator.test.ts
│   │   │   │   ├── sustainabilityCalculator.ts
│   │   │   │   └── types.ts
│   │   │   ├── fraudDetection.test.ts
│   │   │   ├── fraudDetection.ts
│   │   │   ├── gstService.test.ts
│   │   │   ├── gstService.ts
│   │   │   ├── metricsService.test.ts
│   │   │   ├── metricsService.ts
│   │   │   ├── pipeline.test.ts
│   │   │   ├── pipeline.ts
│   │   │   ├── reallocationService.test.ts
│   │   │   ├── reallocationService.ts
│   │   │   └── reasoningGenerator.ts
│   │   └── utils/
│   │       ├── .gitkeep
│   │       ├── database.test.ts
│   │       ├── database.ts
│   │       ├── redisStreams.test.ts
│   │       ├── redisStreams.ts
│   │       ├── retry.test.ts
│   │       ├── retry.ts
│   │       └── test-helpers.ts
│   ├── tsconfig.json
│   └── vitest.config.ts
├── docker-compose.yml
├── frontend/
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api/
│   │   │   └── client.ts
│   │   ├── components/
│   │   │   ├── AIReasoningStream.tsx
│   │   │   ├── DemoBanner.tsx
│   │   │   ├── FeatureImportance.tsx
│   │   │   └── Layout.tsx
│   │   ├── main.tsx
│   │   ├── pages/
│   │   │   ├── CircularDashboard.tsx
│   │   │   ├── Configuration.tsx
│   │   │   ├── CourierEscalations.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Decisions.tsx
│   │   │   ├── FlashDeals.tsx
│   │   │   ├── HubConsole.tsx
│   │   │   ├── InspectionCenter.tsx
│   │   │   ├── Metrics.tsx
│   │   │   ├── PassportList.tsx
│   │   │   ├── PassportView.tsx
│   │   │   ├── QRScanner.tsx
│   │   │   ├── RTOEvents.tsx
│   │   │   ├── ResaleMarketplace.tsx
│   │   │   └── SellProduct.tsx
│   │   └── vite-env.d.ts
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── ml-service/
│   ├── conftest.py
│   ├── pyproject.toml
│   ├── requirements.txt
│   ├── rto_ml_service.egg-info/
│   │   ├── PKG-INFO
│   │   ├── SOURCES.txt
│   │   ├── dependency_links.txt
│   │   ├── requires.txt
│   │   └── top_level.txt
│   ├── src/
│   │   ├── __init__.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── circuit_breaker.py
│   │   │   ├── routes.py
│   │   │   └── schemas.py
│   │   ├── app.py
│   │   ├── config.py
│   │   ├── main.py
│   │   ├── ml/
│   │   │   ├── __init__.py
│   │   │   ├── root_cause_classifier.py
│   │   │   └── sale_recovery_predictor.py
│   │   └── rto_ml_service.egg-info/
│   │       ├── PKG-INFO
│   │       ├── SOURCES.txt
│   │       ├── dependency_links.txt
│   │       └── top_level.txt
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py
│       ├── test_app_factory.py
│       ├── test_circuit_breaker.py
│       ├── test_classify_endpoint.py
│       ├── test_config_properties.py
│       ├── test_health.py
│       ├── test_predict_recovery_endpoint.py
│       ├── test_root_cause_classifier.py
│       └── test_sale_recovery_predictor.py
└── store/
    ├── backend/
    │   ├── .gitignore
    │   ├── package-lock.json
    │   ├── package.json
    │   ├── src/
    │   │   ├── ai/
    │   │   │   └── ai_engine.py
    │   │   ├── config/
    │   │   │   ├── db.ts
    │   │   │   ├── multer.ts
    │   │   │   └── seed.ts
    │   │   ├── models/
    │   │   │   ├── AIReport.ts
    │   │   │   ├── Donation.ts
    │   │   │   ├── Listing.ts
    │   │   │   ├── Order.ts
    │   │   │   ├── Review.ts
    │   │   │   ├── Transaction.ts
    │   │   │   ├── TrustScore.ts
    │   │   │   └── User.ts
    │   │   ├── routes/
    │   │   │   └── api.ts
    │   │   ├── server.ts
    │   │   └── services/
    │   │       ├── googlemaps.ts
    │   │       └── rapidapi.ts
    │   ├── tsconfig.json
    │   └── uploads/
    │       ├── video-1781505512805-100008841.mp4
    │       └── video-1781505628633-920765700.mp4
    ├── frontend/
    │   ├── .eslintrc.json
    │   ├── .gitignore
    │   ├── README.md
    │   ├── next.config.mjs
    │   ├── package-lock.json
    │   ├── package.json
    │   ├── postcss.config.mjs
    │   ├── src/
    │   │   ├── app/
    │   │   │   ├── admin-dashboard/
    │   │   │   │   └── page.tsx
    │   │   │   ├── donation-opportunities/
    │   │   │   │   └── page.tsx
    │   │   │   ├── favicon.ico
    │   │   │   ├── fonts/
    │   │   │   │   ├── GeistMonoVF.woff
    │   │   │   │   └── GeistVF.woff
    │   │   │   ├── globals.css
    │   │   │   ├── green-rewards/
    │   │   │   │   └── page.tsx
    │   │   │   ├── green-wallet/
    │   │   │   │   └── page.tsx
    │   │   │   ├── impact-dashboard/
    │   │   │   │   └── page.tsx
    │   │   │   ├── layout.tsx
    │   │   │   ├── login/
    │   │   │   │   └── page.tsx
    │   │   │   ├── orders/
    │   │   │   │   └── page.tsx
    │   │   │   ├── page.tsx
    │   │   │   ├── products/
    │   │   │   │   └── [id]/
    │   │   │   │       └── page.tsx
    │   │   │   ├── search/
    │   │   │   │   └── page.tsx
    │   │   │   ├── seller-dashboard/
    │   │   │   │   └── page.tsx
    │   │   │   └── sustainability-dashboard/
    │   │   │       └── page.tsx
    │   │   └── components/
    │   │       ├── AmazonHeader.tsx
    │   │       ├── BuyingOptions.tsx
    │   │       └── SellModal.tsx
    │   ├── tailwind.config.ts
    │   └── tsconfig.json
    ├── package-lock.json
    └── package.json

```

## Quick Start

### Prerequisites
- Node.js >= 18
- Python >= 3.10
- Docker & Docker Compose

### Start Infrastructure
```bash
docker-compose up -d
```

### Backend
```bash
cd backend
npm install
npm run dev
```

### ML Service
```bash
cd ml-service
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Backend API | 3000 | Express REST API + Event Processing |
| ML Service | 8000 | FastAPI ML endpoints |
| Frontend | 5173 | React Dashboard |
| MongoDB | 27017 | Primary database |
| Redis | 6379 | Message queue + Cache |
