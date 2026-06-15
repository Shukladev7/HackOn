import { seedDemoData } from './seed';
import { seedFlashDeals } from './seedFlashDeals';

/**
 * Auto-seeds demo data on startup if DEMO_MODE=true.
 * Called after MongoDB connection is established.
 */
export async function autoSeedIfDemoMode(): Promise<void> {
  const demoMode = process.env.DEMO_MODE;
  if (demoMode === 'true' || demoMode === '1') {
    console.log('🧪 DEMO_MODE enabled — seeding demo data...');
    try {
      const counts = await seedDemoData();
      console.log('✅ Demo data seeded successfully:', counts);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Demo seed failed:', message);
    }

    try {
      await seedFlashDeals();
      console.log('✅ Flash Deal seed scenarios loaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Flash Deal seed failed:', message);
    }
  }
}
