import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { config } from './index';

describe('Config', () => {
  it('should have correct default values', () => {
    expect(config.confidenceThreshold).toBe(0.6);
    expect(config.subCauseConfidenceThreshold).toBe(0.5);
    expect(config.recoveryProbabilityThreshold).toBe(0.3);
    expect(config.courierRedeliveryRecoveryThreshold).toBe(0.5);
    expect(config.searchRadiusKm).toBe(50);
    expect(config.cartRecencyDays).toBe(7);
    expect(config.intentThreshold).toBe(0.6);
    expect(config.refusalLookbackDays).toBe(90);
  });

  it('should have ranking weights that sum to 1.0', () => {
    const { distance, conversion, speed, margin } = config.rankingWeights;
    const sum = distance + conversion + speed + margin;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('should have correct buyer ranking defaults', () => {
    expect(config.rankingWeights.distance).toBe(0.25);
    expect(config.rankingWeights.conversion).toBe(0.35);
    expect(config.rankingWeights.speed).toBe(0.20);
    expect(config.rankingWeights.margin).toBe(0.20);
    expect(config.minBuyerScore).toBe(0.4);
    expect(config.maxRankedBuyers).toBe(10);
  });

  it('should have correct fraud detection defaults', () => {
    expect(config.fraudRtoCountThreshold).toBe(5);
    expect(config.fraudTimeWindowDays).toBe(30);
  });

  it('should have correct courier escalation defaults', () => {
    expect(config.courierEscalationWindowDays).toBe(7);
    expect(config.courierEscalationThreshold).toBe(3);
  });

  it('should have correct event buffering and retry defaults', () => {
    expect(config.eventBufferCapacity).toBe(500000);
    expect(config.retryMaxAttempts).toBe(3);
    expect(config.retryInitialDelayMs).toBe(1000);
  });

  it('should have correct evidence collection defaults', () => {
    expect(config.evidenceSourceTimeoutMs).toBe(5000);
    expect(config.minEvidenceSources).toBe(3);
    expect(config.evidenceLookbackHours).toBe(72);
  });

  it('should have correct data retention defaults', () => {
    expect(config.evidenceRetentionDays).toBe(90);
    expect(config.eventRetentionDays).toBe(365);
    expect(config.auditRetentionYears).toBe(7);
  });
});
