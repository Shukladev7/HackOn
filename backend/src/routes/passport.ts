import { Router, Request, Response } from 'express';
import { ProductPassport } from '../models/ProductPassport';

const router = Router();

/**
 * GET /api/v1/passports
 * List all product passports
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const passports = await ProductPassport.find({}).sort({ passportId: 1 });
    res.json({ passports, count: passports.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

/**
 * GET /api/v1/passports/qr/:qrValue
 * Lookup passport by QR code value
 */
router.get('/qr/:qrValue', async (req: Request, res: Response): Promise<void> => {
  try {
    const qrValue = req.params['qrValue'];
    const passport = await ProductPassport.findOne({ qrCodeValue: qrValue });
    if (!passport) {
      res.status(404).json({ success: false, message: `Passport not found for QR: ${qrValue}` });
      return;
    }
    res.json({ passport });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

/**
 * GET /api/v1/passports/:passportId
 * Get single passport by passportId
 */
router.get('/:passportId', async (req: Request, res: Response): Promise<void> => {
  try {
    const passportId = req.params['passportId'];
    const passport = await ProductPassport.findOne({ passportId });
    if (!passport) {
      res.status(404).json({ success: false, message: `Passport ${passportId} not found` });
      return;
    }
    res.json({ passport });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

/**
 * POST /api/v1/passports/:passportId/scan
 * Simulate hub scan — updates status and adds routing event
 */
router.post('/:passportId/scan', async (req: Request, res: Response): Promise<void> => {
  try {
    const passportId = req.params['passportId'];
    const passport = await ProductPassport.findOne({ passportId });
    if (!passport) {
      res.status(404).json({ success: false, message: `Passport ${passportId} not found` });
      return;
    }

    passport.currentStatus = 'at_hub';
    passport.routingHistory.push({
      event: 'Hub Scan Completed',
      timestamp: new Date().toISOString(),
      details: `Package scanned at ${passport.currentLocation.hub}. Condition verified.`,
      status: 'completed',
    });

    await passport.save();
    res.json({ success: true, passport, message: 'Package scanned successfully at hub' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

/**
 * POST /api/v1/passports/:passportId/dispatch
 * Simulate dispatch — updates status to routed
 */
router.post('/:passportId/dispatch', async (req: Request, res: Response): Promise<void> => {
  try {
    const passportId = req.params['passportId'];
    const passport = await ProductPassport.findOne({ passportId });
    if (!passport) {
      res.status(404).json({ success: false, message: `Passport ${passportId} not found` });
      return;
    }

    passport.currentStatus = 'routed';
    passport.routingHistory.push({
      event: 'Package Dispatched',
      timestamp: new Date().toISOString(),
      details: `Dispatched to ${passport.reservedBuyer?.name || 'new buyer'} in ${passport.reservedBuyer?.city || 'nearby city'}`,
      status: 'active',
    });

    await passport.save();
    res.json({ success: true, passport, message: 'Package dispatched to new buyer' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

/**
 * POST /api/v1/passports/:passportId/analyze
 * Run AI analysis — returns eligibility + reasoning steps
 */
router.post('/:passportId/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const passportId = req.params['passportId'];
    const passport = await ProductPassport.findOne({ passportId });
    if (!passport) {
      res.status(404).json({ success: false, message: `Passport ${passportId} not found` });
      return;
    }

    // Simulated AI analysis
    const conditionScores: Record<string, number> = {
      'new': 100,
      'like_new': 92,
      'good': 78,
      'fair': 55,
    };

    const conditionScore = conditionScores[passport.condition] || 70;
    const demandScore = Math.min(98, passport.eligibilityScore + 5);
    const locationScore = passport.reservedBuyer ? 90 : 60;
    const overallScore = Math.round((conditionScore * 0.4 + demandScore * 0.35 + locationScore * 0.25));

    const analysis = {
      passportId: passport.passportId,
      eligibilityScore: passport.eligibilityScore,
      overallScore,
      condition: passport.condition,
      reasoning: [
        {
          step: 1,
          label: 'Condition Assessment',
          score: conditionScore,
          detail: `Product is in "${passport.condition}" condition. ${conditionScore >= 80 ? 'Suitable for direct reallocation.' : 'Minor refurbishment may be needed.'}`,
        },
        {
          step: 2,
          label: 'Demand Analysis',
          score: demandScore,
          detail: `${passport.reservedBuyer ? `Active buyer ${passport.reservedBuyer.name} identified in ${passport.reservedBuyer.city}.` : 'Searching for matching buyers in nearby locations.'}`,
        },
        {
          step: 3,
          label: 'Location Optimization',
          score: locationScore,
          detail: `${passport.reservedBuyer ? `Buyer is ${passport.reservedBuyer.distance} from hub. Direct routing saves 85% transit cost.` : 'Evaluating nearby fulfillment options.'}`,
        },
        {
          step: 4,
          label: 'Cost-Benefit Analysis',
          score: overallScore,
          detail: `Circular routing saves estimated Rs 340 vs warehouse return. CO2 reduction: 2.1 kg.`,
        },
      ],
      recommendation: overallScore >= 75 ? 'APPROVE_CIRCULAR_ROUTING' : 'WAREHOUSE_RETURN',
      costSaving: `Rs ${Math.round(200 + passport.eligibilityScore * 2)}`,
      co2Saving: `${(1.2 + passport.eligibilityScore * 0.02).toFixed(1)} kg`,
      confidence: Math.min(99, overallScore + 3),
    };

    // Update routing history
    passport.routingHistory.push({
      event: 'AI Analysis Complete',
      timestamp: new Date().toISOString(),
      details: `Eligibility: ${overallScore}/100. Recommendation: ${analysis.recommendation}`,
      status: 'completed',
    });
    await passport.save();

    res.json({ success: true, analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

export default router;
