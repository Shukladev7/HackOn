import { Router, Request, Response } from 'express';
import { seedDemoData, clearAllCollections } from '../demo/seed';
import { getScenarios, getScenarioById } from '../demo/scenarios';

const router = Router();

/**
 * POST /api/v1/demo/seed
 * Seeds the database with demo data.
 */
router.post('/seed', async (_req: Request, res: Response) => {
  try {
    const counts = await seedDemoData();
    res.json({
      success: true,
      message: 'Demo data seeded successfully',
      counts,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Demo seed error:', message);
    res.status(500).json({
      success: false,
      message: 'Failed to seed demo data',
      error: message,
    });
  }
});

/**
 * POST /api/v1/demo/reset
 * Clears all collections and re-seeds with fresh demo data.
 */
router.post('/reset', async (_req: Request, res: Response) => {
  try {
    await clearAllCollections();
    const counts = await seedDemoData();
    res.json({
      success: true,
      message: 'Demo data reset and re-seeded successfully',
      counts,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Demo reset error:', message);
    res.status(500).json({
      success: false,
      message: 'Failed to reset demo data',
      error: message,
    });
  }
});

/**
 * GET /api/v1/demo/scenarios
 * Returns all 8 pre-built demo scenarios.
 */
router.get('/scenarios', (_req: Request, res: Response) => {
  const scenarios = getScenarios();
  res.json({
    scenarios: scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      rootCause: s.rootCause.category,
      action: s.decision.action,
      recoveryProbability: s.recoveryProbability,
    })),
    count: scenarios.length,
  });
});

/**
 * GET /api/v1/demo/scenarios/:id
 * Returns a specific scenario with full pipeline data.
 */
router.get('/scenarios/:id', (req: Request, res: Response): void => {
  const id = parseInt(req.params['id'] ?? '', 10);
  if (isNaN(id) || id < 1 || id > 8) {
    res.status(400).json({
      success: false,
      message: 'Invalid scenario ID. Must be between 1 and 8.',
    });
    return;
  }

  const scenario = getScenarioById(id);
  if (!scenario) {
    res.status(404).json({
      success: false,
      message: `Scenario ${id} not found`,
    });
    return;
  }

  res.json({ scenario });
});

export default router;
