# RTO Reallocation Engine

AI-powered In-Transit Inventory Reallocation Engine that intercepts RTO (Return-To-Origin) shipments and determines optimal next actions: redeliver, reallocate to a nearby buyer, or return to warehouse.

## Project Structure

```
├── backend/        # Node.js + Express + TypeScript API server
├── ml-service/     # Python + FastAPI ML service (classification, prediction)
├── frontend/       # React + Vite + TypeScript dashboard
└── docker-compose.yml  # MongoDB + Redis for local development
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
