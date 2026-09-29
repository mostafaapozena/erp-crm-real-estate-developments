import {
  ContractSchema,
  InstallmentSchema,
  QuotationSchema,
  ReceiptSchema,
  money,
  type Contract,
  type Installment,
} from '@alola/contracts';
import { createFormatters } from '@alola/i18n';
import { describe, expect, it } from 'vitest';
import type { Block, PdfDocumentModel } from '../../platform/pdf';
import { buildDocument, type BuildContext } from './builders';
import { translator } from './labels';

/**
 * The business rules of generated documents, checked on the block model — no PDF needed: what a
 * document says about its state, which rows count, and what it must never imply.
 */

const egp = (amount: string) => money(amount, 'EGP');
const at = '2026-09-29T08:00:00.000Z';

function context(locale: 'ar' | 'en' = 'en'): BuildContext {
  return {
    locale,
    t: translator(locale),
    f: createFormatters(locale, { timeZone: 'Africa/Cairo' }),
    company: {
      version: 3,
      legalName: { ar: 'شركة', en: 'Example Developments S.A.E.' },
      tradeName: { ar: 'المثال', en: 'Example Developments' },
      shortName: { ar: 'المثال', en: 'Example' },
      commercialRegistration: 'CR-1',
    },
    verification: {
      url: 'https://example.invalid/verify/token',
      fingerprint: '0000-1111-2222-3333',
    },
    issuedAt: new Date(at),
    issuedOn: '29/09/2026',
    version: 1,
  };
}

const base = {
  contractId: 'ctr_00000000000000000000000001',
  contractNumber: 'CTR-2026-00001',
  customerId: 'cus_00000000000000000000000001',
  unitId: 'unt_00000000000000000000000001',
  projectId: 'prj_00000000000000000000000001',
  reservationId: 'rsv_00000000000000000000000001',
  contractedOn: '2026-09-29',
  totalPrice: egp('3150000'),
  reservationAmount: egp('100000'),
  paymentPlan: {
    downPayment: egp('600000'),
    installmentCount: 2,
    frequency: 'monthly',
    firstDueOn: '2026-10-29',
    maintenanceDeposit: { amount: egp('150000'), dueOn: '2027-09-29' },
  },
  outstandingAmount: egp('3050000'),
  paidAmount: egp('100000'),
  pricing: {
    agreedPrice: egp('3000000'),
    discountPercentage: '5',
    reservationAmount: egp('100000'),
    maintenanceDeposit: egp('150000'),
  },
  customerSnapshot: {
    customerId: 'cus_00000000000000000000000001',
    kind: 'individual',
    name: 'Ahmed Abdallah',
    primaryPhone: '+201000000000',
  },
  parties: [
    {
      role: 'buyer',
      customerId: 'cus_00000000000000000000000001',
      sharePercent: '60',
      name: 'Ahmed Abdallah',
    },
    {
      role: 'coBuyer',
      customerId: 'cus_00000000000000000000000002',
      sharePercent: '40',
      name: 'Sara El-Sayed',
    },
    { role: 'guarantor', customerId: 'cus_00000000000000000000000003', name: 'Omar Farouk' },
  ],
  signing: { state: 'unsigned' },
  exceptions: [],
  warnings: ['identityMissing', 'notSigned'],
  approvals: [],
  amendments: [],
  refundHandoff: 'notApplicable',
  salesOwnerAccountId: 'acc_owner',
  legalEntityId: 'le_00000000000000000000000001',
  branchId: 'br_00000000000000000000000001',
  version: 1,
  createdAt: at,
  updatedAt: at,
};

const contract = (overrides: Record<string, unknown>): Contract =>
  ContractSchema.parse({ ...base, ...overrides });

const row = (sequence: number, state: string, amount: string, paid = '0'): Installment =>
  InstallmentSchema.parse({
    installmentId: `ins_0000000000000000000000000${sequence}`,
    contractId: base.contractId,
    customerId: base.customerId,
    unitId: base.unitId,
    projectId: base.projectId,
    sequence,
    kind: sequence === 1 ? 'downPayment' : 'installment',
    dueOn: '2026-10-29',
    amount: egp(amount),
    paidAmount: egp(paid),
    remainingAmount: egp(String(Number(amount) - Number(paid))),
    state,
    legalEntityId: base.legalEntityId,
    branchId: base.branchId,
    salesOwnerAccountId: 'acc_owner',
    version: 1,
    createdAt: at,
    updatedAt: at,
  });

/** Intl separates a currency from its figure with a no-break space; compare with a plain one. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);
const plain = (value: string | undefined) => (value ?? '').split(NO_BREAK_SPACE).join(' ');
const text = (model: PdfDocumentModel) =>
  plain(JSON.stringify([model.title, model.subtitle, model.watermark, model.status, model.blocks]));
const tables = (model: PdfDocumentModel) =>
  model.blocks.filter(
    (block): block is Extract<Block, { kind: 'table' }> => block.kind === 'table',
  );

describe('contract summary', () => {
  it('marks a draft as a draft, on every page, and says it is not the legal contract', () => {
    const model = buildDocument(context(), {
      type: 'contractSummary',
      contract: contract({ state: 'draft', draftSchedule: [] }),
      installments: [],
    });
    expect(model.watermark).toBe('DRAFT');
    expect(model.status).toMatchObject({ label: 'Draft', tone: 'warning' });
    expect(model.subtitle).toContain('not the legal contract');
    expect(text(model)).toContain('A draft contract, not yet activated');
    expect(text(model)).toContain('No approved legal wording');
    expect(text(model)).toContain('No identity document is recorded for the buyer');
    expect(model.footerNote).toContain('Contract summary');
  });

  it('shows every party with the recorded name and exact share, and a guarantor with none', () => {
    const model = buildDocument(context(), {
      type: 'contractSummary',
      contract: contract({ state: 'active' }),
      installments: [],
    });
    const [parties] = tables(model);
    expect(parties?.rows.map((r) => r.cells)).toEqual([
      ['Buyer', 'Ahmed Abdallah', '60%'],
      ['Co-buyer', 'Sara El-Sayed', '40%'],
      ['Guarantor', 'Omar Farouk', ''],
    ]);
    expect(model.watermark).toBeUndefined();
  });

  it('keeps the maintenance deposit apart from the price', () => {
    const model = buildDocument(context(), {
      type: 'contractSummary',
      contract: contract({ state: 'active' }),
      installments: [],
    });
    const flat = text(model);
    expect(flat).toContain('Maintenance deposit (not part of the unit price)');
    expect(flat).toContain('EGP 150,000.00');
    expect(flat).toContain('EGP 3,000,000.00');
    expect(flat).toContain('The maintenance deposit is a separate amount');
  });

  it('shows a rescheduled instalment muted and leaves it out of every total', () => {
    const model = buildDocument(context(), {
      type: 'installmentSchedule',
      contract: contract({ state: 'active' }),
      installments: [
        row(1, 'partiallyPaid', '600000', '100000'),
        row(2, 'rescheduled', '1000000'),
        row(3, 'upcoming', '1000000'),
      ],
    });
    const [schedule] = tables(model);
    const rescheduled = schedule?.rows.find((r) => r.cells[0] === '2');
    expect(rescheduled?.tone).toBe('muted');
    expect(rescheduled?.cells.at(-1)).toBe('Rescheduled');
    const total = schedule?.rows.at(-1);
    expect(total).toMatchObject({ tone: 'strong' });
    // 600,000 + 1,000,000 — the rescheduled million is not counted.
    expect(plain(total?.cells[3])).toBe('EGP 1,600,000.00');
    expect(text(model)).toContain('not counted in the totals');
  });

  it('labels a cancelled contract as cancelled', () => {
    const model = buildDocument(context('ar'), {
      type: 'contractSummary',
      contract: contract({ state: 'cancelled' }),
      installments: [],
    });
    expect(model.watermark).toBe('ملغي');
    expect(model.status?.tone).toBe('danger');
  });
});

describe('quotation', () => {
  const quotation = (state: string) =>
    QuotationSchema.parse({
      quotationId: 'quo_00000000000000000000000001',
      quotationNumber: 'QUO-2026-00001',
      revision: 3,
      customerId: base.customerId,
      unitId: base.unitId,
      unitCode: 'OASIS-A-0504',
      projectId: base.projectId,
      listPrice: egp('3000000'),
      agreedPrice: egp('2850000'),
      discountPercentage: '5',
      paymentPlan: {
        downPayment: egp('0'),
        installmentCount: 1,
        frequency: 'monthly',
        firstDueOn: '2026-10-29',
      },
      rows: [{ sequence: 1, kind: 'installment', dueOn: '2026-10-29', amount: egp('2850000') }],
      total: egp('2850000'),
      validUntil: '2026-10-15',
      state,
      salesOwnerAccountId: 'acc_owner',
      legalEntityId: base.legalEntityId,
      branchId: base.branchId,
      createdAt: at,
      updatedAt: at,
    });

  it('never implies a reservation, and names its revision and validity', () => {
    const model = buildDocument(context(), { type: 'quotation', quotation: quotation('active') });
    const flat = text(model);
    expect(flat).toContain('does not reserve the unit');
    expect(model.subtitle).toContain('revision 3');
    expect(flat).toContain('15/10/2026');
    expect(model.watermark).toBeUndefined();
  });

  it.each([
    ['expired', 'This quotation has expired.'],
    ['withdrawn', 'This quotation was withdrawn and is no longer valid.'],
    ['superseded', 'replaced by a newer revision and is no longer valid'],
  ])('marks a %s quotation on every page and says so', (state, notice) => {
    const model = buildDocument(context(), { type: 'quotation', quotation: quotation(state) });
    expect(model.watermark).toBeDefined();
    expect(model.status?.tone).toBe('danger');
    expect(text(model)).toContain(notice);
  });
});

describe('receipt', () => {
  it('says a reversed receipt is not evidence of payment', () => {
    const receipt = ReceiptSchema.parse({
      receiptId: 'rcp_00000000000000000000000001',
      receiptNumber: 'RCP-2026-00001',
      customerId: base.customerId,
      contractId: base.contractId,
      projectId: base.projectId,
      amount: egp('250000'),
      method: 'bankTransfer',
      depositReference: 'INTERNAL-ACCOUNT-7',
      allocations: [
        {
          installmentId: 'ins_00000000000000000000000001',
          sequence: 1,
          dueOn: '2026-10-29',
          amount: egp('250000'),
        },
      ],
      receivedByAccountId: 'acc_cashier',
      receivedOn: '2026-09-29',
      state: 'reversed',
      reversedAt: at,
      legalEntityId: base.legalEntityId,
      branchId: base.branchId,
      createdAt: at,
      updatedAt: at,
    });
    const model = buildDocument(context(), {
      type: 'receipt',
      receipt,
      contractNumber: 'CTR-2026-00001',
    });
    const flat = text(model);
    expect(flat).toContain('not evidence of payment');
    expect(model.watermark).toBeDefined();
    // The internal deposit account is never printed on a customer's receipt.
    expect(flat).not.toContain('INTERNAL-ACCOUNT-7');
  });
});
