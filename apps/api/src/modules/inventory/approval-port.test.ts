import { describe, expect, it } from 'vitest';
import { approvalPercentage } from './approval-port';

describe('approvalPercentage (INV-PRICE-003)', () => {
  it.each([
    ['10', '10'],
    ['-7.5', '7.5'],
    ['12.34567', '12.3456'],
    ['0', '0'],
    ['999.9999', '999.9999'],
    // Beyond what the engine's condition field holds: past any threshold, so capped.
    ['1500', '999.9999'],
    ['-2500.5', '999.9999'],
  ])('%s → %s', (signed, expected) => {
    expect(approvalPercentage(signed)).toBe(expected);
  });
});
