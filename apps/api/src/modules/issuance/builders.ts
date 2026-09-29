import {
  addMoney,
  buildInstallmentSchedule,
  money,
  type Contract,
  type Customer,
  type CustomerFinancialSummary,
  type Installment,
  type IssuedDocumentType,
  type Locale,
  type LocalizedLabel,
  type Money,
  type Quotation,
  type Receipt,
  type Reservation,
  type ScheduleRow,
} from '@alola/contracts';
import type { Formatters } from '@alola/i18n';
import {
  ltrIsolate,
  type Block,
  type PdfDocumentModel,
  type TableRow,
  type Tone,
} from '../../platform/pdf';
import type { Translate } from './labels';

/**
 * Business documents as block models (CORE-DOC-003).
 *
 * Every builder reads the **stored** record — the contract's snapshots, the quotation's revision, the
 * receipt as posted — never a live profile, so a document says what the record said when it was
 * issued. Values are formatted once here (Western digits, SD-23) and any value placed inside a
 * sentence is direction-isolated (`ltrIsolate`).
 *
 * No legal wording is written here. A contract summary says, on every page, that it is not the legal
 * contract; approved wording appears only when the client has published it in the template registry
 * (CORE-DOC-002), and is printed exactly as published.
 */

export interface CompanyForDocument {
  version: number;
  legalName: LocalizedLabel;
  tradeName: LocalizedLabel;
  shortName: LocalizedLabel;
  commercialRegistration?: string;
  taxRegistration?: string;
  address?: LocalizedLabel;
  phone?: string;
  email?: string;
  documentFooter?: LocalizedLabel;
  logo?: Buffer;
  primaryColor?: string;
}

/** What each type is drawn from, read through the owning modules' scoped, field-restricted reads. */
export type SourceData =
  | {
      type: 'quotation';
      quotation: Quotation;
      recipientName?: string;
      projectName?: LocalizedLabel;
    }
  | {
      type: 'reservation';
      reservation: Reservation;
      customerName?: string;
      unitCode?: string;
      projectName?: LocalizedLabel;
    }
  | { type: 'contractSummary'; contract: Contract; installments: Installment[] }
  | { type: 'installmentSchedule'; contract: Contract; installments: Installment[] }
  | {
      type: 'receipt';
      receipt: Receipt;
      customerName?: string;
      contractNumber?: string;
    }
  | {
      type: 'customerStatement';
      customer: Customer;
      summary: CustomerFinancialSummary;
      contracts: Contract[];
      receipts: Receipt[];
      openInstallments: Installment[];
      statementNumber: string;
    };

export interface BuildContext {
  locale: Locale;
  t: Translate;
  f: Formatters;
  company: CompanyForDocument;
  verification: { url: string; fingerprint: string };
  issuedAt: Date;
  issuedOn: string;
  version: number;
  /** Approved wording from the template registry, already filled in. */
  registry?: { body: string };
}

/* ----------------------------------------------------------------- helpers */

function initials(name: string): string {
  const words = name
    .replace(/^ال/, '')
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}

function companyLines(company: CompanyForDocument, locale: Locale, t: Translate): string[] {
  const lines: string[] = [];
  if (company.legalName[locale] !== company.tradeName[locale])
    lines.push(company.legalName[locale]);
  const registrations = [
    company.commercialRegistration
      ? `${t('pdf.company.commercialRegistration')}: ${ltrIsolate(company.commercialRegistration)}`
      : undefined,
    company.taxRegistration
      ? `${t('pdf.company.taxRegistration')}: ${ltrIsolate(company.taxRegistration)}`
      : undefined,
  ].filter((line): line is string => line !== undefined);
  if (registrations.length > 0) lines.push(registrations.join(' · '));
  if (company.address) lines.push(company.address[locale]);
  const contact = [company.phone, company.email]
    .filter((value): value is string => value !== undefined)
    .map((value) => ltrIsolate(value));
  if (contact.length > 0) lines.push(contact.join(' · '));
  return lines;
}

/** Everything every document shares: company header, reference, verification, footer, page label. */
function frame(
  context: BuildContext,
  parts: {
    type: IssuedDocumentType;
    reference: { label: string; value: string };
    status?: { label: string; tone: Tone };
    watermark?: string;
    subtitle?: string;
    blocks: Block[];
  },
): PdfDocumentModel {
  const { t, locale, company } = context;
  const title = t(`pdf.type.${parts.type}`);
  return {
    locale,
    title,
    ...(parts.subtitle ? { subtitle: parts.subtitle } : {}),
    reference: parts.reference,
    ...(parts.status ? { status: parts.status } : {}),
    ...(parts.watermark ? { watermark: parts.watermark } : {}),
    company: {
      name: company.tradeName[locale],
      lines: companyLines(company, locale, t),
      ...(company.documentFooter ? { footer: company.documentFooter[locale] } : {}),
      ...(company.logo ? { logo: company.logo } : {}),
      initials: initials(company.shortName[locale]),
      ...(company.primaryColor ? { primaryColor: company.primaryColor } : {}),
    },
    blocks: parts.blocks,
    verification: {
      url: context.verification.url,
      caption: t('pdf.verification.caption'),
      hint: t('pdf.verification.hint'),
      fingerprint: context.verification.fingerprint,
      fingerprintLabel: t('pdf.verification.fingerprint'),
    },
    footerNote: t('pdf.footer.issued', {
      type: title,
      version: ltrIsolate(String(context.version)),
      date: ltrIsolate(context.issuedOn),
    }),
    pageLabel: (page, total) => t('pdf.page', { page, total }),
    meta: {
      title: `${title} ${parts.reference.value}`,
      subject: title,
      creationDate: context.issuedAt,
    },
  };
}

const moneyOf = (context: BuildContext, value: Money) => context.f.money(value, 2);
const dateOf = (context: BuildContext, value: string) =>
  context.f.businessDate(value as Parameters<Formatters['businessDate']>[0]);
const percentOf = (context: BuildContext, value: string) =>
  `${context.f.number(value.startsWith('-') ? '0' : value)}%`;

function kindLabel(context: BuildContext, row: { kind: string; label?: LocalizedLabel }): string {
  return row.label ? row.label[context.locale] : context.t(`installmentKind.${row.kind}`);
}

function scheduleTable(
  context: BuildContext,
  rows: ScheduleRow[],
  total: Money | undefined,
): Block {
  const { t } = context;
  const tableRows: TableRow[] = rows.map((row) => ({
    cells: [
      String(row.sequence),
      kindLabel(context, row),
      dateOf(context, row.dueOn),
      moneyOf(context, row.amount),
    ],
  }));
  if (total) {
    tableRows.push({
      cells: ['', t('pdf.field.total'), '', moneyOf(context, total)],
      tone: 'strong',
    });
  }
  return {
    kind: 'table',
    columns: [
      { header: '#', weight: 0.6 },
      { header: t('pdf.field.kind'), weight: 3 },
      { header: t('pdf.field.dueOn'), weight: 2.2, align: 'end' },
      { header: t('pdf.field.amount'), weight: 2.6, align: 'end' },
    ],
    rows: tableRows,
    empty: t('pdf.empty.schedule'),
  };
}

/** Stored instalments, with rows that no longer count shown muted and left out of the total. */
function installmentTable(context: BuildContext, installments: Installment[]): Block[] {
  const { t } = context;
  const counted = (row: Installment) => row.state !== 'rescheduled' && row.state !== 'cancelled';
  const ordered = [...installments].sort((a, b) => a.sequence - b.sequence);
  const zero = money('0', ordered[0]?.amount.currency ?? 'EGP');
  const total = ordered.filter(counted).reduce((sum, row) => addMoney(sum, row.amount), zero);
  const paid = ordered.filter(counted).reduce((sum, row) => addMoney(sum, row.paidAmount), zero);
  const remaining = ordered
    .filter(counted)
    .reduce((sum, row) => addMoney(sum, row.remainingAmount), zero);
  const rows: TableRow[] = ordered.map((row) => ({
    cells: [
      String(row.sequence),
      kindLabel(context, row),
      dateOf(context, row.dueOn),
      moneyOf(context, row.amount),
      moneyOf(context, row.paidAmount),
      t(`installmentState.${row.state}`),
    ],
    ...(counted(row) ? {} : { tone: 'muted' as const }),
  }));
  if (ordered.length > 0) {
    rows.push({
      cells: ['', t('pdf.field.total'), '', moneyOf(context, total), moneyOf(context, paid), ''],
      tone: 'strong',
    });
  }
  const blocks: Block[] = [
    {
      kind: 'table',
      columns: [
        { header: '#', weight: 0.6 },
        { header: t('pdf.field.kind'), weight: 2.4 },
        { header: t('pdf.field.dueOn'), weight: 2, align: 'end' },
        { header: t('pdf.field.amount'), weight: 2.4, align: 'end' },
        { header: t('pdf.field.paid'), weight: 2.2, align: 'end' },
        { header: t('pdf.field.state'), weight: 2 },
      ],
      rows,
      empty: t('pdf.empty.schedule'),
    },
  ];
  if (ordered.some((row) => !counted(row))) {
    blocks.push({ kind: 'paragraph', text: t('pdf.note.rescheduledExcluded'), muted: true });
  }
  if (ordered.length > 0) {
    blocks.push({
      kind: 'fields',
      columns: 3,
      items: [
        { label: t('pdf.field.scheduleTotal'), value: moneyOf(context, total) },
        { label: t('pdf.field.paid'), value: moneyOf(context, paid) },
        { label: t('pdf.field.remaining'), value: moneyOf(context, remaining) },
      ],
    });
  }
  return blocks;
}

function registryBlocks(context: BuildContext): Block[] {
  if (!context.registry) return [];
  return [
    { kind: 'heading', text: context.t('pdf.heading.terms') },
    { kind: 'paragraph', text: context.registry.body },
  ];
}

/* ----------------------------------------------------------------- builders */

function quotation(
  context: BuildContext,
  data: Extract<SourceData, { type: 'quotation' }>,
): PdfDocumentModel {
  const { t, locale } = context;
  const q = data.quotation;
  const blocks: Block[] = [
    { kind: 'notice', tone: 'info', text: t('pdf.notice.quotationNoReservation') },
  ];
  if (q.state !== 'active') {
    blocks.push({ kind: 'notice', tone: 'danger', text: t(`pdf.notice.quotation.${q.state}`) });
  }
  blocks.push(
    { kind: 'heading', text: t('pdf.heading.details') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        { label: t('pdf.field.recipient'), value: data.recipientName ?? '—' },
        { label: t('pdf.field.revision'), value: String(q.revision) },
        { label: t('pdf.field.validUntil'), value: dateOf(context, q.validUntil) },
        { label: t('pdf.field.unit'), value: q.unitCode, ltr: true },
        { label: t('pdf.field.project'), value: data.projectName?.[locale] ?? '—' },
        { label: t('pdf.field.state'), value: t(`quotationState.${q.state}`) },
      ],
    },
    { kind: 'heading', text: t('pdf.heading.price') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        { label: t('pdf.field.listPrice'), value: moneyOf(context, q.listPrice) },
        { label: t('pdf.field.agreedPrice'), value: moneyOf(context, q.agreedPrice) },
        { label: t('pdf.field.discount'), value: percentOf(context, q.discountPercentage) },
        ...(q.paymentPlan.maintenanceDeposit
          ? [
              {
                label: t('pdf.field.maintenanceDeposit'),
                value: moneyOf(context, q.paymentPlan.maintenanceDeposit.amount),
              },
            ]
          : []),
        { label: t('pdf.field.totalPayable'), value: moneyOf(context, q.total) },
      ],
    },
    { kind: 'heading', text: t('pdf.heading.plan') },
    scheduleTable(context, q.rows, q.total),
  );
  if (q.paymentPlan.maintenanceDeposit) {
    blocks.push({ kind: 'paragraph', text: t('pdf.note.maintenanceDeposit'), muted: true });
  }
  return frame(context, {
    type: 'quotation',
    reference: { label: t('pdf.reference.quotation'), value: q.quotationNumber },
    subtitle: t('pdf.subtitle.quotation', { revision: q.revision }),
    status: {
      label: t(`quotationState.${q.state}`),
      tone: q.state === 'active' ? 'info' : 'danger',
    },
    ...(q.state !== 'active' ? { watermark: t(`quotationState.${q.state}`) } : {}),
    blocks,
  });
}

const RESERVATION_TONE: Record<Reservation['state'], Tone> = {
  draft: 'warning',
  pendingApproval: 'warning',
  approved: 'info',
  confirmed: 'success',
  converted: 'success',
  cancelled: 'danger',
  expired: 'danger',
  rejected: 'danger',
};

function reservation(
  context: BuildContext,
  data: Extract<SourceData, { type: 'reservation' }>,
): PdfDocumentModel {
  const { t, locale } = context;
  const r = data.reservation;
  const ended = r.state === 'cancelled' || r.state === 'expired' || r.state === 'rejected';
  const blocks: Block[] = [];
  if (r.state === 'draft' || r.state === 'pendingApproval' || r.state === 'approved') {
    blocks.push({ kind: 'notice', tone: 'warning', text: t(`pdf.notice.reservation.${r.state}`) });
  }
  if (ended)
    blocks.push({ kind: 'notice', tone: 'danger', text: t('pdf.notice.reservation.ended') });
  blocks.push(
    { kind: 'heading', text: t('pdf.heading.details') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        { label: t('pdf.field.customer'), value: data.customerName ?? '—' },
        { label: t('pdf.field.unit'), value: data.unitCode ?? '—', ltr: true },
        { label: t('pdf.field.project'), value: data.projectName?.[locale] ?? '—' },
        { label: t('pdf.field.reservedOn'), value: dateOf(context, r.reservedOn) },
        { label: t('pdf.field.expiresOn'), value: dateOf(context, r.expiresOn) },
        { label: t('pdf.field.state'), value: t(`reservationState.${r.state}`) },
      ],
    },
    { kind: 'heading', text: t('pdf.heading.price') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        ...(r.listPrice
          ? [{ label: t('pdf.field.listPrice'), value: moneyOf(context, r.listPrice) }]
          : []),
        { label: t('pdf.field.agreedPrice'), value: moneyOf(context, r.agreedPrice) },
        { label: t('pdf.field.discount'), value: percentOf(context, r.discountPercentage) },
        { label: t('pdf.field.reservationAmount'), value: moneyOf(context, r.reservationAmount) },
      ],
    },
  );
  let rows: ScheduleRow[];
  try {
    rows = buildInstallmentSchedule(r.agreedPrice, r.paymentPlan);
  } catch {
    // A stored plan was valid when it was stored; a document is never refused over a preview.
    rows = [];
  }
  blocks.push(
    { kind: 'heading', text: t('pdf.heading.proposedPlan') },
    scheduleTable(context, rows, undefined),
    { kind: 'paragraph', text: t('pdf.note.proposedPlan'), muted: true },
    ...registryBlocks(context),
    {
      kind: 'signatures',
      labels: [t('pdf.signature.customer'), t('pdf.signature.company'), t('pdf.signature.stamp')],
    },
  );
  return frame(context, {
    type: 'reservation',
    reference: { label: t('pdf.reference.reservation'), value: r.reservationNumber },
    status: { label: t(`reservationState.${r.state}`), tone: RESERVATION_TONE[r.state] },
    ...(ended || r.state === 'draft' || r.state === 'pendingApproval'
      ? { watermark: t(`reservationState.${r.state}`) }
      : {}),
    blocks,
  });
}

const CONTRACT_TONE: Record<Contract['state'], Tone> = {
  draft: 'warning',
  pendingApproval: 'warning',
  active: 'success',
  completed: 'success',
  cancelled: 'danger',
};

function contractWatermark(context: BuildContext, contract: Contract): string | undefined {
  if (contract.state === 'draft' || contract.state === 'pendingApproval') {
    return context.t('pdf.watermark.draft');
  }
  if (contract.state === 'cancelled') return context.t('contractState.cancelled');
  return undefined;
}

function contractNotices(context: BuildContext, contract: Contract): Block[] {
  const { t } = context;
  const blocks: Block[] = [];
  if (contract.state === 'draft' || contract.state === 'pendingApproval') {
    blocks.push({ kind: 'notice', tone: 'warning', text: t('pdf.notice.draftContract') });
  }
  if (contract.state === 'cancelled') {
    blocks.push({ kind: 'notice', tone: 'danger', text: t('pdf.notice.cancelledContract') });
  }
  if (contract.warnings.includes('identityMissing')) {
    blocks.push({ kind: 'notice', tone: 'warning', text: t('contractWarning.identityMissing') });
  }
  return blocks;
}

function contractSummary(
  context: BuildContext,
  data: Extract<SourceData, { type: 'contractSummary' }>,
): PdfDocumentModel {
  const { t, locale } = context;
  const c = data.contract;
  const blocks: Block[] = [...contractNotices(context, c)];
  if (!context.registry) {
    blocks.push({ kind: 'notice', tone: 'info', text: t('pdf.notice.noApprovedWording') });
  }
  if (c.warnings.includes('notSigned') && c.state === 'active') {
    blocks.push({ kind: 'notice', tone: 'info', text: t('contractWarning.notSigned') });
  }
  // Parties, as recorded on the contract — never re-read from the customer's current profile.
  blocks.push(
    { kind: 'heading', text: t('pdf.heading.parties') },
    {
      kind: 'table',
      columns: [
        { header: t('pdf.field.role'), weight: 2 },
        { header: t('pdf.field.name'), weight: 5 },
        { header: t('pdf.field.share'), weight: 2, align: 'end' },
      ],
      rows: c.parties.map((party) => ({
        cells: [
          t(`contractPartyRole.${party.role}`),
          party.name ?? (party.role === 'buyer' ? (c.customerSnapshot?.name ?? '—') : '—'),
          party.sharePercent ? percentOf(context, party.sharePercent) : '',
        ],
      })),
    },
  );
  const buyer = c.customerSnapshot;
  if (buyer) {
    blocks.push(
      { kind: 'heading', text: t('pdf.heading.buyer') },
      {
        kind: 'fields',
        columns: 3,
        items: [
          { label: t('pdf.field.name'), value: buyer.name },
          { label: t('pdf.field.phone'), value: buyer.primaryPhone, ltr: true },
          ...(buyer.email ? [{ label: t('pdf.field.email'), value: buyer.email, ltr: true }] : []),
          ...(buyer.identity
            ? [
                {
                  label: t(`identityType.${buyer.identity.type}`),
                  value: buyer.identity.number,
                  ltr: true,
                },
              ]
            : []),
          ...(buyer.city ? [{ label: t('pdf.field.city'), value: buyer.city }] : []),
          ...(buyer.address ? [{ label: t('pdf.field.address'), value: buyer.address }] : []),
        ],
      },
    );
  }
  const unit = c.unitSnapshot;
  blocks.push(
    { kind: 'heading', text: t('pdf.heading.unit') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        { label: t('pdf.field.unit'), value: unit?.code ?? '—', ltr: true },
        { label: t('pdf.field.project'), value: unit?.projectName?.[locale] ?? '—' },
        ...(unit?.floor !== undefined
          ? [{ label: t('pdf.field.floor'), value: String(unit.floor) }]
          : []),
        ...(unit?.propertyType
          ? [{ label: t('pdf.field.propertyType'), value: t(`propertyType.${unit.propertyType}`) }]
          : []),
        ...(unit?.area
          ? [
              {
                label: t('pdf.field.area'),
                value: t('pdf.unit.area', { area: context.f.number(unit.area) }),
              },
            ]
          : []),
        ...(unit?.finishingStatus
          ? [
              {
                label: t('pdf.field.finishing'),
                value: t(`finishingStatus.${unit.finishingStatus}`),
              },
            ]
          : []),
      ],
    },
  );
  const pricing = c.pricing;
  blocks.push(
    { kind: 'heading', text: t('pdf.heading.price') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        ...(pricing?.listPrice
          ? [{ label: t('pdf.field.listPrice'), value: moneyOf(context, pricing.listPrice) }]
          : []),
        {
          label: t('pdf.field.agreedPrice'),
          value: moneyOf(context, pricing?.agreedPrice ?? c.totalPrice),
        },
        ...(pricing
          ? [
              {
                label: t('pdf.field.discount'),
                value: percentOf(context, pricing.discountPercentage),
              },
            ]
          : []),
        ...(pricing?.maintenanceDeposit
          ? [
              {
                label: t('pdf.field.maintenanceDeposit'),
                value: moneyOf(context, pricing.maintenanceDeposit),
              },
            ]
          : []),
        { label: t('pdf.field.contractTotal'), value: moneyOf(context, c.totalPrice) },
        { label: t('pdf.field.reservationCredited'), value: moneyOf(context, c.reservationAmount) },
        { label: t('pdf.field.contractedOn'), value: dateOf(context, c.contractedOn) },
        {
          label: t('pdf.field.signing'),
          value:
            c.signing.state === 'signed' && c.signing.signedOn
              ? t('pdf.value.signedOn', { date: ltrIsolate(dateOf(context, c.signing.signedOn)) })
              : t('signingState.unsigned'),
        },
      ],
    },
  );
  if (pricing?.maintenanceDeposit) {
    blocks.push({ kind: 'paragraph', text: t('pdf.note.maintenanceDeposit'), muted: true });
  }
  blocks.push({ kind: 'heading', text: t('pdf.heading.schedule') });
  if (c.state === 'draft' || c.state === 'pendingApproval') {
    blocks.push(scheduleTable(context, c.draftSchedule ?? [], c.totalPrice), {
      kind: 'paragraph',
      text: t('pdf.note.proposedPlan'),
      muted: true,
    });
  } else {
    blocks.push(...installmentTable(context, data.installments));
  }
  const applied = c.amendments.filter((amendment) => amendment.state === 'applied');
  if (applied.length > 0) {
    blocks.push({
      kind: 'paragraph',
      text: t('pdf.note.amendments', { count: applied.length }),
      muted: true,
    });
  }
  blocks.push(...registryBlocks(context), {
    kind: 'signatures',
    labels: [
      t('pdf.signature.buyer'),
      ...c.parties
        .filter((party) => party.role !== 'buyer')
        .map((party) => t(`contractPartyRole.${party.role}`)),
      t('pdf.signature.company'),
      t('pdf.signature.stamp'),
    ],
  });
  const watermark = contractWatermark(context, c);
  return frame(context, {
    type: 'contractSummary',
    reference: { label: t('pdf.reference.contract'), value: c.contractNumber },
    subtitle: context.registry
      ? t('pdf.subtitle.contractWithWording')
      : t('pdf.subtitle.contractSummary'),
    status: { label: t(`contractState.${c.state}`), tone: CONTRACT_TONE[c.state] },
    ...(watermark ? { watermark } : {}),
    blocks,
  });
}

function installmentSchedule(
  context: BuildContext,
  data: Extract<SourceData, { type: 'installmentSchedule' }>,
): PdfDocumentModel {
  const { t } = context;
  const c = data.contract;
  const blocks: Block[] = [...contractNotices(context, c)];
  blocks.push(
    { kind: 'heading', text: t('pdf.heading.details') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        { label: t('pdf.field.customer'), value: c.customerSnapshot?.name ?? '—' },
        { label: t('pdf.field.unit'), value: c.unitSnapshot?.code ?? '—', ltr: true },
        { label: t('pdf.field.contractedOn'), value: dateOf(context, c.contractedOn) },
        { label: t('pdf.field.contractTotal'), value: moneyOf(context, c.totalPrice) },
        { label: t('pdf.field.paid'), value: moneyOf(context, c.paidAmount) },
        { label: t('pdf.field.outstanding'), value: moneyOf(context, c.outstandingAmount) },
      ],
    },
    { kind: 'heading', text: t('pdf.heading.schedule') },
  );
  if (c.state === 'draft' || c.state === 'pendingApproval') {
    blocks.push(scheduleTable(context, c.draftSchedule ?? [], c.totalPrice), {
      kind: 'paragraph',
      text: t('pdf.note.proposedPlan'),
      muted: true,
    });
  } else {
    blocks.push(...installmentTable(context, data.installments));
  }
  blocks.push(...registryBlocks(context));
  const watermark = contractWatermark(context, c);
  return frame(context, {
    type: 'installmentSchedule',
    reference: { label: t('pdf.reference.contract'), value: c.contractNumber },
    subtitle: t('pdf.subtitle.asOf', { date: ltrIsolate(context.issuedOn) }),
    status: { label: t(`contractState.${c.state}`), tone: CONTRACT_TONE[c.state] },
    ...(watermark ? { watermark } : {}),
    blocks,
  });
}

function receipt(
  context: BuildContext,
  data: Extract<SourceData, { type: 'receipt' }>,
): PdfDocumentModel {
  const { t } = context;
  const r = data.receipt;
  const reversed = r.state === 'reversed';
  const blocks: Block[] = [];
  if (reversed) {
    blocks.push({
      kind: 'notice',
      tone: 'danger',
      text: r.reversedAt
        ? t('pdf.notice.reversedReceiptOn', {
            date: ltrIsolate(context.f.instant(r.reversedAt, 'date')),
          })
        : t('pdf.notice.reversedReceipt'),
    });
  }
  blocks.push(
    { kind: 'heading', text: t('pdf.heading.details') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        { label: t('pdf.field.customer'), value: data.customerName ?? '—' },
        { label: t('pdf.field.contract'), value: data.contractNumber ?? '—', ltr: true },
        { label: t('pdf.field.receivedOn'), value: dateOf(context, r.receivedOn) },
        { label: t('pdf.field.amount'), value: moneyOf(context, r.amount) },
        { label: t('pdf.field.method'), value: t(`paymentMethod.${r.method}`) },
        ...(r.transactionReference
          ? [
              {
                label: t('pdf.field.transactionReference'),
                value: r.transactionReference,
                ltr: true,
              },
            ]
          : []),
      ],
    },
    { kind: 'heading', text: t('pdf.heading.allocations') },
    {
      kind: 'table',
      columns: [
        { header: '#', weight: 0.8 },
        { header: t('pdf.field.dueOn'), weight: 3, align: 'end' },
        { header: t('pdf.field.amount'), weight: 3, align: 'end' },
      ],
      rows: [
        ...r.allocations.map((allocation) => ({
          cells: [
            String(allocation.sequence),
            dateOf(context, allocation.dueOn),
            moneyOf(context, allocation.amount),
          ],
          ...(reversed ? { tone: 'muted' as const } : {}),
        })),
        { cells: ['', t('pdf.field.total'), moneyOf(context, r.amount)], tone: 'strong' as const },
      ],
    },
    ...registryBlocks(context),
    { kind: 'signatures', labels: [t('pdf.signature.cashier'), t('pdf.signature.stamp')] },
  );
  return frame(context, {
    type: 'receipt',
    reference: { label: t('pdf.reference.receipt'), value: r.receiptNumber },
    status: { label: t(`receiptState.${r.state}`), tone: reversed ? 'danger' : 'success' },
    ...(reversed ? { watermark: t(`receiptState.${r.state}`) } : {}),
    blocks,
  });
}

function customerStatement(
  context: BuildContext,
  data: Extract<SourceData, { type: 'customerStatement' }>,
): PdfDocumentModel {
  const { t } = context;
  const s = data.summary;
  const contractNumbers = new Map(data.contracts.map((c) => [c.contractId, c.contractNumber]));
  const blocks: Block[] = [
    { kind: 'heading', text: t('pdf.heading.customer') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        { label: t('pdf.field.name'), value: data.customer.name },
        { label: t('pdf.field.phone'), value: data.customer.primaryPhone, ltr: true },
        { label: t('pdf.field.asOf'), value: context.issuedOn },
      ],
    },
    { kind: 'heading', text: t('pdf.heading.position') },
    {
      kind: 'fields',
      columns: 3,
      items: [
        { label: t('pdf.field.contracts'), value: String(s.contracts) },
        { label: t('pdf.field.contracted'), value: moneyOf(context, s.totalContracted) },
        { label: t('pdf.field.paid'), value: moneyOf(context, s.totalPaid) },
        { label: t('pdf.field.outstanding'), value: moneyOf(context, s.totalOutstanding) },
        { label: t('pdf.field.overdueCount'), value: String(s.overdueCount) },
        { label: t('pdf.field.overdueAmount'), value: moneyOf(context, s.overdueAmount) },
      ],
    },
    { kind: 'heading', text: t('pdf.heading.contracts') },
    {
      kind: 'table',
      columns: [
        { header: t('pdf.field.contract'), weight: 3, ltr: true },
        { header: t('pdf.field.state'), weight: 2 },
        { header: t('pdf.field.contractTotal'), weight: 3, align: 'end' },
        { header: t('pdf.field.paid'), weight: 3, align: 'end' },
        { header: t('pdf.field.outstanding'), weight: 3, align: 'end' },
      ],
      rows: data.contracts.map((c) => ({
        cells: [
          c.contractNumber,
          t(`contractState.${c.state}`),
          moneyOf(context, c.totalPrice),
          moneyOf(context, c.paidAmount),
          moneyOf(context, c.outstandingAmount),
        ],
        ...(c.state === 'cancelled' ? { tone: 'muted' as const } : {}),
      })),
      empty: t('pdf.empty.contracts'),
    },
    { kind: 'heading', text: t('pdf.heading.openInstallments') },
    {
      kind: 'table',
      columns: [
        { header: t('pdf.field.contract'), weight: 3, ltr: true },
        { header: '#', weight: 0.8 },
        { header: t('pdf.field.dueOn'), weight: 2.4, align: 'end' },
        { header: t('pdf.field.remaining'), weight: 3, align: 'end' },
        { header: t('pdf.field.state'), weight: 2 },
      ],
      rows: [...data.openInstallments]
        .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.sequence - b.sequence))
        .map((row) => ({
          cells: [
            contractNumbers.get(row.contractId) ?? '—',
            String(row.sequence),
            dateOf(context, row.dueOn),
            moneyOf(context, row.remainingAmount),
            t(`installmentState.${row.state}`),
          ],
        })),
      empty: t('pdf.empty.openInstallments'),
    },
    { kind: 'heading', text: t('pdf.heading.receipts') },
    {
      kind: 'table',
      columns: [
        { header: t('pdf.field.receipt'), weight: 3, ltr: true },
        { header: t('pdf.field.receivedOn'), weight: 2.4, align: 'end' },
        { header: t('pdf.field.amount'), weight: 3, align: 'end' },
        { header: t('pdf.field.state'), weight: 2 },
      ],
      rows: data.receipts.map((r) => ({
        cells: [
          r.receiptNumber,
          dateOf(context, r.receivedOn),
          moneyOf(context, r.amount),
          t(`receiptState.${r.state}`),
        ],
        ...(r.state === 'reversed' ? { tone: 'muted' as const } : {}),
      })),
      empty: t('pdf.empty.receipts'),
    },
    { kind: 'paragraph', text: t('pdf.note.statement'), muted: true },
    ...registryBlocks(context),
  ];
  return frame(context, {
    type: 'customerStatement',
    reference: { label: t('pdf.reference.statement'), value: data.statementNumber },
    subtitle: t('pdf.subtitle.asOf', { date: ltrIsolate(context.issuedOn) }),
    blocks,
  });
}

export function buildDocument(context: BuildContext, data: SourceData): PdfDocumentModel {
  switch (data.type) {
    case 'quotation':
      return quotation(context, data);
    case 'reservation':
      return reservation(context, data);
    case 'contractSummary':
      return contractSummary(context, data);
    case 'installmentSchedule':
      return installmentSchedule(context, data);
    case 'receipt':
      return receipt(context, data);
    case 'customerStatement':
      return customerStatement(context, data);
  }
}
