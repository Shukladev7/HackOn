import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import rtoEventsRouter from './routes/rtoEvents';
import rtoEventDetailsRouter from './routes/rtoEventDetails';
import ordersRouter from './routes/orders';
import packagesRouter from './routes/packages';
import couriersRouter from './routes/couriers';
import configRouter from './routes/configRoutes';
import metricsRouter from './routes/metrics';
import demoRouter from './routes/demo';
import passportRouter from './routes/passport';
import flashDealsRouter from './routes/flashDeals';
import { autoSeedIfDemoMode } from './demo/autoSeed';
import { config } from './config';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(config.mongodbUri)
  .then(async () => {
    console.log('Connected to MongoDB');
    await autoSeedIfDemoMode();
  })
  .catch((err) => console.error('MongoDB connection error:', err.message));

// Health check endpoint
app.get('/api/v1/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'rto-reallocation-backend',
    timestamp: new Date().toISOString(),
  });
});

// RTO Events ingress endpoint (POST)
app.use('/api/v1/rto-events', rtoEventsRouter);

// RTO Event detail routes (GET :id, :id/decision, :id/timeline)
app.use('/api/v1/rto-events', rtoEventDetailsRouter);

// Orders routes
app.use('/api/v1/orders', ordersRouter);

// Packages routes
app.use('/api/v1/packages', packagesRouter);

// Couriers routes
app.use('/api/v1/couriers', couriersRouter);

// Configuration routes
app.use('/api/v1/config', configRouter);

// Metrics routes
app.use('/api/v1/metrics', metricsRouter);

// Demo routes
app.use('/api/v1/demo', demoRouter);

// Passport routes (Circular Routing Engine)
app.use('/api/v1/passports', passportRouter);

// Flash Deal Eligibility Engine routes
app.use('/api/v1/flash-deals', flashDealsRouter);

app.listen(PORT, () => {
  console.log(`RTO Reallocation Backend running on port ${PORT}`);
});

export default app;
