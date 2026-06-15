/**
 * Passport Integration Service
 *
 * Manages routing history event creation in the ProductPassport model during
 * flash deal evaluations. All functions gracefully handle errors — they log
 * and continue without blocking the evaluation.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7
 */

import { ProductPassport } from '../../models/ProductPassport';
import { DispositionDecision, FeatureVector } from './types';
import { getDisplayLabel } from './dispositionDecider';

// ─── Grade → Condition Mapping ───────────────────────────────────────────────

const GRADE_TO_CONDITION: Record<string, 'like_new' | 'good' | 'fair'> = {
  A: 'like_new',
  B: 'good',
  C: 'fair',
  D: 'fair',
  F: 'fair',
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Appends a "Flash Deal Evaluation Started" event to the passport's routing history.
 * If the passport is not found, logs a warning and returns without throwing.
 */
export async function appendEvaluationStarted(
  passportId: string,
  evaluationId: string
): Promise<void> {
  try {
    const passport = await ProductPassport.findOne({ passportId });

    if (!passport) {
      console.warn(
        `[PassportIntegration] Passport not found for passportId="${passportId}". Skipping evaluation started event.`
      );
      return;
    }

    passport.routingHistory.push({
      event: 'Flash Deal Evaluation Started',
      timestamp: new Date().toISOString(),
      details: `Evaluation ${evaluationId} initiated`,
      status: 'active',
    });

    await passport.save();
  } catch (error) {
    console.error(
      `[PassportIntegration] Failed to append evaluation started event for passportId="${passportId}":`,
      error
    );
  }
}

/**
 * Appends an "AI Analysis Complete" event to the passport's routing history.
 * If the passport is not found, logs a warning and returns without throwing.
 */
export async function appendAnalysisComplete(
  passportId: string,
  score: number,
  decision: DispositionDecision
): Promise<void> {
  try {
    const passport = await ProductPassport.findOne({ passportId });

    if (!passport) {
      console.warn(
        `[PassportIntegration] Passport not found for passportId="${passportId}". Skipping analysis complete event.`
      );
      return;
    }

    passport.routingHistory.push({
      event: 'AI Analysis Complete',
      timestamp: new Date().toISOString(),
      details: `Flash Deal Score: ${score}/100. Decision: ${decision}`,
      status: 'completed',
    });

    await passport.save();
  } catch (error) {
    console.error(
      `[PassportIntegration] Failed to append analysis complete event for passportId="${passportId}":`,
      error
    );
  }
}

/**
 * Appends disposition-specific routing events to the passport's routing history.
 *
 * - FLASH_DEAL: Appends "Flash Deal Eligible" event. If nearbyBuyers > 0, also
 *   appends a "Buyer Reserved" event with buyer city and distance details.
 * - Other dispositions: Appends "Routed to {displayLabel}" event.
 *
 * If the passport is not found, logs a warning and returns without throwing.
 */
export async function appendDispositionEvent(
  passportId: string,
  decision: DispositionDecision,
  nearbyBuyers: number,
  city: string,
  distance: number
): Promise<void> {
  try {
    const passport = await ProductPassport.findOne({ passportId });

    if (!passport) {
      console.warn(
        `[PassportIntegration] Passport not found for passportId="${passportId}". Skipping disposition event.`
      );
      return;
    }

    if (decision === 'FLASH_DEAL') {
      passport.routingHistory.push({
        event: 'Flash Deal Eligible',
        timestamp: new Date().toISOString(),
        details: `Product eligible for flash deal`,
        status: 'completed',
      });

      if (nearbyBuyers > 0) {
        passport.routingHistory.push({
          event: 'Buyer Reserved',
          timestamp: new Date().toISOString(),
          details: `Buyer in ${city}, ${distance} km away`,
          status: 'pending',
        });
      }
    } else {
      const displayLabel = getDisplayLabel(decision);
      passport.routingHistory.push({
        event: `Routed to ${displayLabel}`,
        timestamp: new Date().toISOString(),
        details: `Product routed to ${displayLabel} channel`,
        status: 'completed',
      });
    }

    await passport.save();
  } catch (error) {
    console.error(
      `[PassportIntegration] Failed to append disposition event for passportId="${passportId}":`,
      error
    );
  }
}

/**
 * Ensures a ProductPassport record exists for the evaluation. If one does not
 * exist, creates a new passport with minimal fields derived from the feature vector.
 *
 * Returns the passportId on success, or null on failure (does not block evaluation).
 */
export async function ensurePassportExists(
  features: FeatureVector,
  evaluationId: string
): Promise<string | null> {
  try {
    const passportId = `flash-deal-${evaluationId}`;

    const existing = await ProductPassport.findOne({ passportId });

    if (existing) {
      return passportId;
    }

    const condition = GRADE_TO_CONDITION[features.condition.inspectionGrade] || 'fair';

    const newPassport = new ProductPassport({
      passportId,
      qrCodeValue: `FD-${evaluationId}`,
      sku: `FD-${features.product.category.toUpperCase().slice(0, 3)}-${Date.now()}`,
      productName: `${features.product.category} Product`,
      category: features.product.category,
      condition,
      currentOwner: 'Flash Deal Engine',
      currentLocation: {
        city: features.location.city,
        hub: `${features.location.city} Hub`,
      },
      currentStatus: 'at_hub',
      eligibilityScore: 0,
      routingHistory: [],
      lifecycleCount: 1,
    });

    await newPassport.save();
    return passportId;
  } catch (error) {
    console.error(
      `[PassportIntegration] Failed to ensure passport exists for evaluationId="${evaluationId}":`,
      error
    );
    return null;
  }
}
