import type { ActorContext, Money } from '@alola/contracts';
import type { RequestContext } from '../../platform/audit-port';

/**
 * The approval engine as inventory sees it (ADR-0024). `submit` resolves to nothing when **no policy
 * applies** — the normal state until `SD-02` / `BD-31` supply one — and the change then proceeds as
 * the permission alone allows: the absence of a configured control is not an approval, and it is not
 * an error either. `state` reads the outcome; inventory acts on it, the engine never does.
 */
export interface InventoryApprovalPort {
  submit(
    actor: ActorContext,
    input: {
      operationType: string;
      source: { type: string; id: string };
      scope: Record<string, string | undefined>;
      context: { amount?: Money; percentage?: string; isException?: boolean };
      summary: { label: { ar: string; en: string }; value: string }[];
      idempotencyKey: string;
    },
    context: RequestContext,
  ): Promise<{ requestId: string; state: string } | undefined>;
  state(requestId: string): Promise<string | undefined>;
  /** Whether a published policy would govern the operation — asked before anything is written. */
  applies(
    actor: ActorContext,
    input: {
      operationType: string;
      scope: Record<string, string | undefined>;
      context: { amount?: Money; percentage?: string; isException?: boolean };
    },
  ): Promise<boolean>;
}

/** Operation types inventory submits; declared in the contracts so labels and policies can name them. */
export { INVENTORY_APPROVAL_OPERATIONS } from '@alola/contracts';

/**
 * A percentage for an approval condition: the absolute value, at most `999.9999`, because the engine's
 * condition field holds three integer digits. A threshold on a price change asks "how large", and a
 * change beyond 999 % is past any threshold anyone sets.
 */
export function approvalPercentage(signed: string): string {
  const absolute = signed.startsWith('-') ? signed.slice(1) : signed;
  const [whole = '0', fraction = ''] = absolute.split('.');
  if (whole.replace(/^0+(?=\d)/, '').length > 3) return '999.9999';
  const trimmed = fraction.slice(0, 4);
  return trimmed ? `${whole}.${trimmed}` : whole;
}
