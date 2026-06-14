/**
 * Unit tests for Redis Streams utilities.
 * Tests the producer, consumer, and connection management logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PIPELINE_STAGES,
  RedisStreamProducer,
  RedisStreamConsumer,
  createConsumerGroup,
  initializePipelineGroups,
  parseStreamEntry,
  sleep,
  type StreamMessage,
  type PipelineStage,
} from './redisStreams';

// ---------------------------------------------------------------------------
// Mock Redis client factory
// ---------------------------------------------------------------------------

function createMockRedisClient() {
  return {
    xadd: vi.fn().mockResolvedValue('1700000000000-0'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    xgroup: vi.fn().mockResolvedValue('OK'),
    xtrim: vi.fn().mockResolvedValue(0),
    quit: vi.fn().mockResolvedValue('OK'),
    on: vi.fn().mockReturnThis(),
    status: 'ready',
  };
}

// ---------------------------------------------------------------------------
// Tests: parseStreamEntry
// ---------------------------------------------------------------------------

describe('parseStreamEntry', () => {
  it('parses flat field array into key-value record', () => {
    const result = parseStreamEntry('123-0', [
      'eventType',
      'RTO_CREATED',
      'sourceEntityId',
      'order-001',
    ]);

    expect(result.id).toBe('123-0');
    expect(result.fields).toEqual({
      eventType: 'RTO_CREATED',
      sourceEntityId: 'order-001',
    });
  });

  it('handles empty fields array', () => {
    const result = parseStreamEntry('456-0', []);
    expect(result.id).toBe('456-0');
    expect(result.fields).toEqual({});
  });

  it('handles odd-length fields array gracefully (ignores trailing key)', () => {
    const result = parseStreamEntry('789-0', ['key1', 'val1', 'key2']);
    expect(result.fields).toEqual({ key1: 'val1' });
  });
});

// ---------------------------------------------------------------------------
// Tests: sleep utility
// ---------------------------------------------------------------------------

describe('sleep', () => {
  it('resolves after specified delay', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow small timing variance
  });
});

// ---------------------------------------------------------------------------
// Tests: PIPELINE_STAGES
// ---------------------------------------------------------------------------

describe('PIPELINE_STAGES', () => {
  it('contains all expected pipeline stages', () => {
    expect(PIPELINE_STAGES).toContain('rto-events');
    expect(PIPELINE_STAGES).toContain('evidence-collection');
    expect(PIPELINE_STAGES).toContain('classification');
    expect(PIPELINE_STAGES).toContain('prediction');
    expect(PIPELINE_STAGES).toContain('demand-matching');
    expect(PIPELINE_STAGES).toContain('buyer-ranking');
    expect(PIPELINE_STAGES).toContain('decision');
    expect(PIPELINE_STAGES).toHaveLength(7);
  });

  it('stages are typed as PipelineStage', () => {
    const stage: PipelineStage = 'rto-events';
    expect(PIPELINE_STAGES).toContain(stage);
  });
});

// ---------------------------------------------------------------------------
// Tests: createConsumerGroup
// ---------------------------------------------------------------------------

describe('createConsumerGroup', () => {
  let mockClient: ReturnType<typeof createMockRedisClient>;

  beforeEach(() => {
    mockClient = createMockRedisClient();
  });

  it('creates a consumer group with MKSTREAM', async () => {
    await createConsumerGroup(mockClient as any, 'test-stream', 'test-group', '0');

    expect(mockClient.xgroup).toHaveBeenCalledWith(
      'CREATE',
      'test-stream',
      'test-group',
      '0',
      'MKSTREAM',
    );
  });

  it('does not throw when group already exists (BUSYGROUP)', async () => {
    mockClient.xgroup.mockRejectedValue(
      new Error('BUSYGROUP Consumer Group name already exists'),
    );

    await expect(
      createConsumerGroup(mockClient as any, 'test-stream', 'test-group'),
    ).resolves.toBeUndefined();
  });

  it('throws on unexpected errors', async () => {
    mockClient.xgroup.mockRejectedValue(new Error('NOPERM'));

    await expect(
      createConsumerGroup(mockClient as any, 'test-stream', 'test-group'),
    ).rejects.toThrow('NOPERM');
  });

  it('uses default startId of 0', async () => {
    await createConsumerGroup(mockClient as any, 'my-stream', 'my-group');

    expect(mockClient.xgroup).toHaveBeenCalledWith(
      'CREATE',
      'my-stream',
      'my-group',
      '0',
      'MKSTREAM',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: initializePipelineGroups
// ---------------------------------------------------------------------------

describe('initializePipelineGroups', () => {
  let mockClient: ReturnType<typeof createMockRedisClient>;

  beforeEach(() => {
    mockClient = createMockRedisClient();
  });

  it('creates consumer groups for all pipeline stages', async () => {
    await initializePipelineGroups(mockClient as any);

    expect(mockClient.xgroup).toHaveBeenCalledTimes(PIPELINE_STAGES.length);

    for (const stage of PIPELINE_STAGES) {
      expect(mockClient.xgroup).toHaveBeenCalledWith(
        'CREATE',
        stage,
        `${stage}-group`,
        '0',
        'MKSTREAM',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: RedisStreamProducer
// ---------------------------------------------------------------------------

describe('RedisStreamProducer', () => {
  let mockClient: ReturnType<typeof createMockRedisClient>;
  let producer: RedisStreamProducer;

  beforeEach(() => {
    mockClient = createMockRedisClient();
    producer = new RedisStreamProducer(mockClient as any);
  });

  it('publishEvent sends data to the stream with auto-generated ID', async () => {
    const id = await producer.publishEvent('rto-events', {
      eventType: 'RTO_CREATED',
      sourceEntityId: 'order-123',
    });

    expect(id).toBe('1700000000000-0');
    expect(mockClient.xadd).toHaveBeenCalledWith(
      'rto-events',
      '*',
      'eventType',
      'RTO_CREATED',
      'sourceEntityId',
      'order-123',
    );
  });

  it('publishStreamMessage sends a full StreamMessage', async () => {
    const msg: StreamMessage = {
      eventType: 'ELIGIBILITY_CHECK',
      sourceEntityId: 'rto-event-001',
      targetEntityId: 'order-001',
      timestamp: '2024-01-15T10:30:00Z',
      actorModule: 'EvidenceCollectionEngine',
      outcomeStatus: 'eligible',
      inputParams: JSON.stringify({ sealIntact: true }),
    };

    const id = await producer.publishStreamMessage('rto-events', msg);

    expect(id).toBe('1700000000000-0');
    expect(mockClient.xadd).toHaveBeenCalledWith(
      'rto-events',
      '*',
      'eventType',
      'ELIGIBILITY_CHECK',
      'sourceEntityId',
      'rto-event-001',
      'targetEntityId',
      'order-001',
      'timestamp',
      '2024-01-15T10:30:00Z',
      'actorModule',
      'EvidenceCollectionEngine',
      'outcomeStatus',
      'eligible',
      'inputParams',
      JSON.stringify({ sealIntact: true }),
    );
  });

  it('trimStream trims to approximate max length', async () => {
    mockClient.xtrim.mockResolvedValue(5);

    const trimmed = await producer.trimStream('rto-events', 500000);

    expect(trimmed).toBe(5);
    expect(mockClient.xtrim).toHaveBeenCalledWith(
      'rto-events',
      'MAXLEN',
      '~',
      500000,
    );
  });

  it('disconnect closes the connection', async () => {
    await producer.disconnect();
    expect(mockClient.quit).toHaveBeenCalled();
  });

  it('disconnect is idempotent (only quits once)', async () => {
    await producer.disconnect();
    await producer.disconnect();
    expect(mockClient.quit).toHaveBeenCalledTimes(1);
  });

  it('getClient returns the underlying redis client', () => {
    expect(producer.getClient()).toBe(mockClient);
  });
});

// ---------------------------------------------------------------------------
// Tests: RedisStreamConsumer
// ---------------------------------------------------------------------------

describe('RedisStreamConsumer', () => {
  let mockClient: ReturnType<typeof createMockRedisClient>;

  beforeEach(() => {
    mockClient = createMockRedisClient();
  });

  it('creates with correct default options', () => {
    const consumer = new RedisStreamConsumer('rto-events', undefined, mockClient as any);
    expect(consumer.isRunning()).toBe(false);
  });

  it('subscribe processes messages and acknowledges them', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    let callCount = 0;

    const consumer = new RedisStreamConsumer(
      'rto-events',
      { group: 'test-group', consumer: 'test-consumer' },
      mockClient as any,
    );

    // Return messages on first call, then stop
    mockClient.xreadgroup.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [
          [
            'rto-events',
            [['1700000000000-0', ['eventType', 'RTO_CREATED', 'sourceEntityId', 'ord-1']]],
          ],
        ];
      }
      consumer.stop();
      return null;
    });

    await consumer.subscribe(handler);

    expect(handler).toHaveBeenCalledWith(
      { id: '1700000000000-0', fields: { eventType: 'RTO_CREATED', sourceEntityId: 'ord-1' } },
      'rto-events',
    );
    expect(mockClient.xack).toHaveBeenCalledWith(
      'rto-events',
      'test-group',
      '1700000000000-0',
    );
  });

  it('subscribe handles multiple messages in a single batch', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    let callCount = 0;

    const consumer = new RedisStreamConsumer(
      'rto-events',
      { group: 'test-group', consumer: 'test-consumer' },
      mockClient as any,
    );

    mockClient.xreadgroup.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [
          [
            'rto-events',
            [
              ['1700000000000-0', ['eventType', 'MSG_1']],
              ['1700000000001-0', ['eventType', 'MSG_2']],
            ],
          ],
        ];
      }
      consumer.stop();
      return null;
    });

    await consumer.subscribe(handler);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(mockClient.xack).toHaveBeenCalledTimes(2);
  });

  it('processPending processes unacknowledged messages', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);

    mockClient.xreadgroup.mockResolvedValue([
      [
        'rto-events',
        [['1700000000001-0', ['eventType', 'PENDING_MSG', 'actorModule', 'test']]],
      ],
    ]);

    const consumer = new RedisStreamConsumer(
      'rto-events',
      { group: 'test-group', consumer: 'test-consumer' },
      mockClient as any,
    );

    const processed = await consumer.processPending(handler);

    expect(processed).toBe(1);
    expect(handler).toHaveBeenCalledWith(
      { id: '1700000000001-0', fields: { eventType: 'PENDING_MSG', actorModule: 'test' } },
      'rto-events',
    );
    expect(mockClient.xack).toHaveBeenCalledWith(
      'rto-events',
      'test-group',
      '1700000000001-0',
    );
  });

  it('processPending skips entries with empty fields', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);

    mockClient.xreadgroup.mockResolvedValue([
      ['rto-events', [['1700000000002-0', []]]],
    ]);

    const consumer = new RedisStreamConsumer(
      'rto-events',
      { group: 'test-group', consumer: 'test-consumer' },
      mockClient as any,
    );

    const processed = await consumer.processPending(handler);
    expect(processed).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('processPending returns 0 when no pending messages', async () => {
    mockClient.xreadgroup.mockResolvedValue(null);

    const consumer = new RedisStreamConsumer(
      'rto-events',
      { group: 'test-group', consumer: 'test-consumer' },
      mockClient as any,
    );

    const processed = await consumer.processPending(vi.fn());
    expect(processed).toBe(0);
  });

  it('stop sets running to false', () => {
    const consumer = new RedisStreamConsumer('rto-events', undefined, mockClient as any);
    consumer.stop();
    expect(consumer.isRunning()).toBe(false);
  });

  it('disconnect stops and quits the client', async () => {
    const consumer = new RedisStreamConsumer('rto-events', undefined, mockClient as any);
    await consumer.disconnect();
    expect(consumer.isRunning()).toBe(false);
    expect(mockClient.quit).toHaveBeenCalled();
  });
});
