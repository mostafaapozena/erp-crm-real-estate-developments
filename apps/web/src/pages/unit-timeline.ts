import type { UnitEvent } from '@alola/contracts';

/**
 * How one unit event reads on the unit page (INV-STATUS-002).
 *
 * The timeline used to label every event by its status, so a price change or an edited bedroom count
 * read as "available" — the event carries no status at all. Each kind now reads as what it is: a
 * status change as a transition, a price change and a details change by name with their reason, and
 * the creation of the unit with its first status. What caused a status change (a hold, a reservation,
 * a contract, a person) is named from the event's source. Stored events are not rewritten; this only
 * decides how they are shown. A price event never shows an amount: prices are field-restricted, and
 * the event stores none.
 */
export type UnitEventSource = 'hold' | 'reservation' | 'contract' | 'priceVersion' | 'manual';

export interface UnitEventView {
  /** The `unitEventKind` label. */
  kind: UnitEvent['kind'];
  /** Present for a status change: the two statuses, in order. */
  transition?: { from: string; to: string };
  /** Present when the unit was created: its first status. */
  initialStatus?: string;
  source: UnitEventSource;
}

export function unitEventView(event: UnitEvent): UnitEventView {
  const source: UnitEventSource =
    event.sourceType === 'hold' ||
    event.sourceType === 'reservation' ||
    event.sourceType === 'contract' ||
    event.sourceType === 'priceVersion'
      ? event.sourceType
      : 'manual';
  switch (event.kind) {
    case 'statusChanged':
      return event.fromStatus && event.toStatus
        ? {
            kind: 'statusChanged',
            transition: { from: event.fromStatus, to: event.toStatus },
            source,
          }
        : { kind: 'statusChanged', source };
    case 'created':
      return {
        kind: 'created',
        ...(event.toStatus ? { initialStatus: event.toStatus } : {}),
        source,
      };
    case 'priceChanged':
      return { kind: 'priceChanged', source };
    case 'attributesChanged':
      return { kind: 'attributesChanged', source };
  }
}
