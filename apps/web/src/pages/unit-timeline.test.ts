import type { UnitEvent } from '@alola/contracts';
import { describe, expect, it } from 'vitest';
import { unitEventView } from './unit-timeline';

const event = (overrides: Partial<UnitEvent>): UnitEvent =>
  ({
    eventId: 'uev_000000000001',
    unitId: 'unit_000000000001',
    projectId: 'prj_000000000001',
    kind: 'statusChanged',
    occurredAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  }) as UnitEvent;

describe('unit timeline categories (regression: every event used to read as a status)', () => {
  it('reads a status change as a transition, naming what caused it', () => {
    expect(
      unitEventView(
        event({
          kind: 'statusChanged',
          fromStatus: 'available',
          toStatus: 'reserved',
          sourceType: 'reservation',
        }),
      ),
    ).toEqual({
      kind: 'statusChanged',
      transition: { from: 'available', to: 'reserved' },
      source: 'reservation',
    });
    expect(
      unitEventView(
        event({
          kind: 'statusChanged',
          fromStatus: 'reserved',
          toStatus: 'contracted',
          sourceType: 'contract',
        }),
      ).source,
    ).toBe('contract');
    expect(
      unitEventView(
        event({
          kind: 'statusChanged',
          fromStatus: 'available',
          toStatus: 'held',
          sourceType: 'hold',
        }),
      ).source,
    ).toBe('hold');
    expect(
      unitEventView(
        event({ kind: 'statusChanged', fromStatus: 'available', toStatus: 'unavailable' }),
      ).source,
    ).toBe('manual');
  });

  it('reads a price change as a price change, never as a status, and shows no amount', () => {
    const view = unitEventView(
      event({
        kind: 'priceChanged',
        sourceType: 'priceVersion',
        sourceId: 'pv_1',
        reason: 'annual review',
      }),
    );
    expect(view).toEqual({ kind: 'priceChanged', source: 'priceVersion' });
    expect(view.transition).toBeUndefined();
  });

  it('reads a details change as a details change', () => {
    expect(
      unitEventView(event({ kind: 'attributesChanged', reason: 'corrected bedrooms' })),
    ).toEqual({
      kind: 'attributesChanged',
      source: 'manual',
    });
  });

  it('reads the creation with its first status', () => {
    expect(unitEventView(event({ kind: 'created', toStatus: 'available' }))).toEqual({
      kind: 'created',
      initialStatus: 'available',
      source: 'manual',
    });
  });

  it('treats an unknown source as manual rather than inventing one', () => {
    expect(
      unitEventView(event({ kind: 'statusChanged', sourceType: 'somethingElse' })).source,
    ).toBe('manual');
  });
});
