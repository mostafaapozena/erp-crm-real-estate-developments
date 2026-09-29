import { money } from '@alola/contracts';
import { describe, expect, it } from 'vitest';
import {
  combinedOutcome,
  comparePercent,
  minimumDepositFor,
  requiredApprovals,
  reservationExceptions,
} from './reservation-rules';

const egp = (amount: string) => money(amount, 'EGP');

describe('minimum deposit (SALE-RESERVE-004, BD-02)', () => {
  it('asks nothing when no rule is configured', () => {
    expect(minimumDepositFor(null, egp('1000000'))).toBeUndefined();
  });

  it('rounds a percentage up to the piastre, so rounding never lowers the rule', () => {
    // 5 % of 1,000,000.01 is 50,000.0005 → 50,000.01.
    expect(minimumDepositFor({ kind: 'percentage', percent: '5' }, egp('1000000.01'))).toEqual(
      egp('50000.01'),
    );
  });

  it('takes a fixed amount as it is, and refuses to compare across currencies', () => {
    expect(
      minimumDepositFor({ kind: 'amount', amount: '50000', currency: 'EGP' }, egp('900000')),
    ).toEqual(egp('50000'));
    expect(
      minimumDepositFor({ kind: 'amount', amount: '1000', currency: 'USD' }, egp('900000')),
    ).toBeNull();
  });
});

describe('exceptions and approvals (SALE-DISCOUNT-001, 002)', () => {
  it('compares percentages exactly, on their digits', () => {
    expect(comparePercent('10.0001', '10')).toBe(1);
    expect(comparePercent('9.9999', '10')).toBe(-1);
    expect(comparePercent('10.00', '10')).toBe(0);
  });

  it('finds no exception while no limit is configured', () => {
    expect(
      reservationExceptions({
        discountPercentage: '40',
        maximumDiscountPercent: null,
        reservationAmount: egp('1'),
        minimumDeposit: undefined,
      }),
    ).toEqual([]);
  });

  it('flags a discount above the maximum and a deposit below the minimum', () => {
    expect(
      reservationExceptions({
        discountPercentage: '12.5',
        maximumDiscountPercent: '10',
        reservationAmount: egp('49999.99'),
        minimumDeposit: egp('50000'),
      }),
    ).toEqual(['discountAboveMaximum', 'depositBelowMinimum']);
    expect(
      reservationExceptions({
        discountPercentage: '10',
        maximumDiscountPercent: '10',
        reservationAmount: egp('50000'),
        minimumDeposit: egp('50000'),
      }),
    ).toEqual([]);
  });

  it('asks for the discount approval for any discount, and an exception approval for each exception', () => {
    expect(requiredApprovals({ discountPercentage: '0', exceptions: [] })).toEqual([]);
    expect(
      requiredApprovals({
        discountPercentage: '12',
        exceptions: ['discountAboveMaximum', 'depositBelowMinimum'],
      }).map((entry) => [entry.operationType, entry.exception]),
    ).toEqual([
      ['sales.reservation.discount', false],
      ['sales.reservation.priceOverride', true],
      ['sales.reservation.exception', true],
    ]);
  });

  it('combines outcomes: any refusal rejects, all approvals approve, anything else waits', () => {
    expect(combinedOutcome(['approved', 'approved'])).toBe('approved');
    expect(combinedOutcome(['approved', 'pending'])).toBe('pending');
    expect(combinedOutcome(['approved', 'rejected'])).toBe('rejected');
    expect(combinedOutcome(['expired'])).toBe('rejected');
    expect(combinedOutcome([undefined])).toBe('pending');
    expect(combinedOutcome([])).toBe('pending');
  });
});
