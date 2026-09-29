import {
  addDays,
  addMonths,
  DecimalStringSchema,
  compareMoney,
  divideMoney,
  money,
  multiplyMoney,
  subtractMoney,
  type ActorContext,
  type Installment,
  type Money,
} from '@alola/contracts';
import type { Logger } from '@alola/security';
import type { DomainServices } from '../../apps/api/src/platform/domain-services';
import {
  BUILDINGS,
  DEMO_CAMPAIGNS,
  DEMO_CURRENCY,
  DEMO_LEADS,
  PROJECTS,
  buildUnits,
  demoPhone,
} from './dataset';
import { C } from './collections';
import { applyDemoIdentity } from './identity';
import { tally, type Counter, type SeedLedger } from './ledger';
import type { SeedFoundation } from './seed';

/**
 * The business half of the demonstration: inventory, the pipeline, two live contracts, the money that
 * has been collected against them, the instruments held in custody, the reminders that fall due, and
 * the marketing drafts.
 *
 * Everything here is written **as one of the demonstration accounts**, through the guarded services:
 * the representative raises the lead and the reservation, the manager confirms it and signs the
 * contract, the collection officer takes the money and generates the reminders, the marketing manager
 * drafts the campaigns. Each of those calls goes through the same permission check, the same data
 * scope and the same audit write that the HTTP routes go through, because it is the same code.
 *
 * The dates are all relative to today, so the demonstration is never stale: there are always paid
 * installments behind, an overdue one, and one falling due inside the fifteen-day reminder window.
 */

export interface BusinessSeedOptions {
  services: DomainServices;
  foundation: SeedFoundation;
  logger: Logger;
  correlationId: string;
  /** The organization timezone, recorded on the company profile. */
  timeZone: string;
}

const egp = (amount: string): Money => money(amount, DEMO_CURRENCY);
const ZERO = egp('0');

/** A percentage of a money amount, exact to the piastre. Never floating point (ADR-0007). */
const percentOf = (amount: Money, percent: string): Money =>
  divideMoney(multiplyMoney(amount, percent), '100', 2);

export async function seedBusiness(options: BusinessSeedOptions): Promise<Counter> {
  const { services, foundation, logger, correlationId, timeZone } = options;
  const context = { correlationId, method: 'CLI', route: 'scripts/seed-demo' };
  const { accountIds, counts, systemActor, ledger } = foundation;

  const actors = await resolveActors(services, accountIds);

  await seedApprovalPolicy(services, systemActor, context, ledger, counts);
  const unitIds = await seedInventory(services, actors.admin, context, foundation);
  const leadIds = await seedPipeline(services, actors, context, foundation);
  await seedCampaigns(services, actors.marketing, context, foundation);
  // The deployment's company identity — configuration, written by the administrator (PLAT-022).
  const identity = await applyDemoIdentity({
    services,
    admin: actors.admin,
    marketing: actors.marketing,
    ledger,
    timeZone,
    context,
  });
  tally(counts, 'companyProfile', identity.companyProfile === 'created');
  await seedDemoSettings(services, foundation.systemActor, context, counts);
  await seedJourneys(services, actors, context, foundation, unitIds, leadIds);

  // The sweep the scheduled job would run. Without it every instalment stays `upcoming` however long
  // ago it fell due, and the demonstration opens on a collections screen with nothing overdue —
  // which is precisely the screen the client is there to see.
  const swept = await services.sales().refreshInstallmentStates(actors.collector, context);
  logger.info(swept, 'instalment states refreshed');

  const reminders = await services
    .collections()
    .generateReminders(actors.collector, { withinDays: 15, channel: 'whatsapp' }, context);
  counts['reminder'] = { created: reminders.created, existing: reminders.existing };
  logger.info(
    { created: reminders.created, existing: reminders.existing, deliveryConnected: false },
    'reminders generated — nothing was delivered, no provider is connected',
  );

  // One reminder is moved to `simulated` so both states are visible side by side on the reminder
  // centre. `simulated` is a distinct state from `sent` on purpose: nothing left this machine.
  const listed = await services
    .collections()
    .listReminders(actors.collector, { limit: 1, state: 'ready' });
  const first = listed.items[0];
  if (first) {
    await services
      .collections()
      .actOnReminder(
        actors.collector,
        first.reminderId,
        { state: 'simulated', reason: 'seeded demonstration — simulated, not delivered' },
        context,
      );
  }

  return counts;
}

/* ------------------------------------------------------------------- actors */

interface DemoActors {
  admin: ActorContext;
  salesManager: ActorContext;
  rep1: ActorContext;
  rep2: ActorContext;
  collector: ActorContext;
  marketing: ActorContext;
}

/**
 * Actors are resolved from **stored grants**, exactly as a request resolves them (SEC-032, ADR-0022).
 * Building them by hand here would let the seed write records that the real permission set could not
 * produce, which is the one thing this script must never do.
 */
async function resolveActors(
  services: DomainServices,
  accountIds: Map<string, string>,
): Promise<DemoActors> {
  const security = services.security();
  const resolve = async (key: string): Promise<ActorContext> => {
    const accountId = accountIds.get(key);
    if (!accountId) throw new Error(`no seeded account for ${key}`);
    const actor = await security.resolveActor(accountId);
    if (!actor) throw new Error(`no grants resolved for ${key}`);
    return actor;
  };
  return {
    admin: await resolve('admin'),
    salesManager: await resolve('salesManager'),
    rep1: await resolve('rep1'),
    rep2: await resolve('rep2'),
    collector: await resolve('collector'),
    marketing: await resolve('marketing'),
  };
}

/* ---------------------------------------------------------- approval policy */

/**
 * A discount above ten percent needs a decision from someone holding the approval permission in the
 * same branch.
 *
 * **This is demonstration configuration, not `SD-02`.** The real thresholds, the real approver roles
 * and the real segregation-of-duty rules are an open stakeholder decision; nothing here closes it.
 * It is seeded because a demonstration of an approval engine with no policy configured shows an empty
 * screen, and because the engine's behaviour — a reservation that cannot be confirmed while its
 * discount is pending — is one of the things worth showing.
 */
async function seedApprovalPolicy(
  services: DomainServices,
  systemActor: ActorContext,
  context: { correlationId: string; method: string; route: string },
  ledger: SeedLedger,
  counts: Counter,
): Promise<void> {
  const approvals = services.approval();
  const result = await ledger.ensure(
    'approvalPolicy:reservation-discount',
    C.approvalPolicies,
    'key',
    async () => {
      const created = await approvals.createPolicy(
        systemActor,
        {
          key: 'reservation-discount',
          name: { ar: 'اعتماد خصم الحجز', en: 'Reservation discount approval' },
          operationType: 'sales.reservation.discount',
          conditions: [{ field: 'percentage', operator: 'gte', value: '10' }],
          stages: [
            {
              order: 1,
              name: { ar: 'اعتماد مدير المبيعات', en: 'Sales manager approval' },
              approvers: {
                kind: 'permission',
                permission: 'approval.request.approve',
                scope: 'same-branch',
              },
              rule: 'any',
              slaHours: 24,
            },
          ],
          selfApproval: 'prohibited',
          allowConcurrentRequests: false,
        },
        context,
      );
      await approvals.publishPolicy(systemActor, created.key, created.version, context);
      return created.key;
    },
  );
  tally(counts, 'approvalPolicy', result.created);
}

/* --------------------------------------------------------- demo settings */

/**
 * Commercial rules a reservation needs before one can exist. **These are demonstration values, not
 * decisions**: BD-01 (reservation validity) stays open in the business decision register, and the
 * reason recorded on the setting says so. A value already configured — by the client, or by an
 * earlier run — is never overwritten.
 */
const DEMO_SETTINGS = [
  { key: 'sales.reservationValidityDays', value: 14, decision: 'BD-01' },
] as const;

async function seedDemoSettings(
  services: DomainServices,
  systemActor: ActorContext,
  context: { correlationId: string; method: string; route: string },
  counts: Counter,
): Promise<void> {
  const settings = services.settings();
  for (const entry of DEMO_SETTINGS) {
    const current = await settings.getSetting(entry.key);
    const create = !current.configured;
    if (create) {
      await settings.updateSetting(
        systemActor,
        entry.key,
        {
          value: entry.value,
          expectedVersion: current.version,
          reason: `demonstration value — ${entry.decision} open, not a business decision`,
        },
        context,
      );
    }
    tally(counts, 'demoSetting', create);
  }
}

/* ---------------------------------------------------------------- inventory */

async function seedInventory(
  services: DomainServices,
  admin: ActorContext,
  context: { correlationId: string; method: string; route: string },
  foundation: SeedFoundation,
): Promise<Map<string, string>> {
  const inventory = services.inventory();
  const { ledger, branchIds, counts } = foundation;

  const projectIds = new Map<string, string>();
  for (const project of PROJECTS) {
    const branchId = branchIds.get(project.branchCode);
    if (!branchId) throw new Error(`unknown branch ${project.branchCode}`);
    const result = await ledger.ensure(
      `project:${project.code}`,
      C.projects,
      'projectId',
      async () => {
        const created = await inventory.createProject(
          admin,
          {
            branchId,
            code: project.code,
            name: project.name,
            city: project.city,
            description: project.description,
            currency: DEMO_CURRENCY,
            status: 'selling',
          },
          context,
        );
        return created.projectId;
      },
    );
    projectIds.set(project.code, result.value);
    tally(counts, 'project', result.created);
  }

  const buildingIds = new Map<string, string>();
  for (const building of BUILDINGS) {
    const projectId = projectIds.get(building.projectCode);
    if (!projectId) throw new Error(`unknown project ${building.projectCode}`);
    const result = await ledger.ensure(
      `building:${building.code}`,
      C.buildings,
      'buildingId',
      async () => {
        const created = await inventory.createBuilding(
          admin,
          {
            projectId,
            code: building.code,
            name: building.name,
            zone: building.zone,
            floors: building.floors,
          },
          context,
        );
        return created.buildingId;
      },
    );
    buildingIds.set(building.code, result.value);
    tally(counts, 'building', result.created);
  }

  const unitIds = new Map<string, string>();
  for (const unit of buildUnits()) {
    const buildingId = buildingIds.get(unit.buildingCode);
    if (!buildingId) throw new Error(`unknown building ${unit.buildingCode}`);
    const result = await ledger.ensure(`unit:${unit.code}`, C.units, 'unitId', async () => {
      const created = await inventory.createUnit(
        admin,
        {
          buildingId,
          code: unit.code,
          floor: unit.floor,
          propertyType: unit.propertyType,
          usageType: unit.usageType,
          area: DecimalStringSchema.parse(unit.area),
          basePrice: egp(unit.basePrice),
          currentPrice: egp(unit.basePrice),
          finishingStatus: unit.finishingStatus,
          view: unit.view,
        },
        context,
      );
      return created.unitId;
    });
    unitIds.set(unit.code, result.value);
    tally(counts, 'unit', result.created);
  }

  // Not every unit is for sale: a handful are withheld so the inventory board shows more than one
  // colour before anybody reserves anything.
  for (const code of ['OASIS-B-0403', 'CORNICHE-T1-0502']) {
    const unitId = unitIds.get(code);
    if (!unitId) continue;
    const marked = await ledger.ensure(`unitHold:${code}`, C.units, 'unitId', async () => {
      const unit = await inventory.getUnit(admin, unitId);
      if (unit.status === 'available') {
        await inventory.changeStatus(
          admin,
          unitId,
          { status: 'unavailable', reason: 'وحدة نموذجية — غير متاحة للبيع' },
          context,
        );
      }
      return unitId;
    });
    tally(counts, 'unitHold', marked.created);
  }

  return unitIds;
}

/* ---------------------------------------------------------------------- CRM */

/**
 * The stages a lead has to walk through to reach a given stage, because `LEAD_TRANSITIONS` refuses a
 * jump. Walking it is the point: the pipeline history in the demonstration is a real history.
 */
const STAGE_PATH: Record<string, string[]> = {
  new: [],
  contacted: ['contacted'],
  qualified: ['contacted', 'qualified'],
  visitScheduled: ['contacted', 'qualified', 'visitScheduled'],
  negotiation: ['contacted', 'qualified', 'visitScheduled', 'negotiation'],
  reservation: ['contacted', 'qualified', 'visitScheduled', 'negotiation'],
  won: ['contacted', 'qualified', 'visitScheduled', 'negotiation'],
  lost: ['contacted', 'lost'],
};

async function seedPipeline(
  services: DomainServices,
  actors: DemoActors,
  context: { correlationId: string; method: string; route: string },
  foundation: SeedFoundation,
): Promise<Map<string, string>> {
  const crm = services.crm();
  const { ledger, branchIds, teamIds, departmentIds, counts, today } = foundation;
  const leadIds = new Map<string, string>();

  for (const lead of DEMO_LEADS) {
    const actor = lead.ownerKey === 'rep1' ? actors.rep1 : actors.rep2;
    const branchId = branchIds.get(lead.branchCode);
    if (!branchId) throw new Error(`unknown branch ${lead.branchCode}`);
    const teamCode = lead.ownerKey === 'rep1' ? 'TM-CAI-S1' : 'TM-CAI-S2';
    const departmentId = departmentIds.get('DP-CAI-SALES');
    const teamId = teamIds.get(teamCode);

    const result = await ledger.ensure(`lead:${lead.key}`, C.leads, 'leadId', async () => {
      const created = await crm.createLead(
        actor,
        {
          name: lead.name,
          primaryPhone: demoPhone(lead.phoneSuffix),
          ...(lead.email ? { email: lead.email } : {}),
          source: lead.source,
          branchId,
          ...(departmentId ? { departmentId } : {}),
          ...(teamId ? { teamId } : {}),
          budgetMin: egp(`${lead.budgetMin}.00`),
          budgetMax: egp(`${lead.budgetMax}.00`),
          notes: lead.notes,
          ...(lead.followUpInDays === undefined
            ? {}
            : { nextFollowUpOn: addDays(today, lead.followUpInDays) }),
        },
        context,
        // Every lead is created by the representative who owns it, so nobody is handing work out and
        // the assignment permission is not needed.
        { mayAssign: false },
      );

      for (const stage of STAGE_PATH[lead.stage] ?? []) {
        await crm.changeStage(
          actor,
          created.lead.leadId,
          {
            stage: stage as 'contacted',
            ...(stage === 'lost' ? { reason: 'الميزانية أقل من المتاح حاليًا' } : {}),
          },
          context,
        );
      }
      return created.lead.leadId;
    });
    leadIds.set(lead.key, result.value);
    tally(counts, 'lead', result.created);

    if (result.created) {
      await crm.addActivity(
        actor,
        result.value,
        { kind: 'call', body: 'مكالمة أولى للتعريف بالمشروع وتحديد الاحتياج.' },
        context,
      );
      tally(counts, 'activity', true);
    }
  }

  return leadIds;
}

/* ---------------------------------------------------------------- marketing */

async function seedCampaigns(
  services: DomainServices,
  marketing: ActorContext,
  context: { correlationId: string; method: string; route: string },
  foundation: SeedFoundation,
): Promise<void> {
  const service = services.marketing();
  const { ledger, branchIds, counts, today } = foundation;

  for (const campaign of DEMO_CAMPAIGNS) {
    const branchId = branchIds.get(campaign.branchCode);
    if (!branchId) throw new Error(`unknown branch ${campaign.branchCode}`);
    const projectId = campaign.projectCode
      ? ledger.existing(`project:${campaign.projectCode}`)
      : undefined;

    const result = await ledger.ensure(
      `campaign:${campaign.key}`,
      C.campaigns,
      'campaignId',
      async () => {
        const created = await service.createCampaign(
          marketing,
          {
            name: campaign.name,
            platform: campaign.platform,
            objective: campaign.objective,
            budget: egp(`${campaign.budget}.00`),
            startsOn: addDays(today, campaign.startsInDays),
            ...(campaign.endsInDays === undefined
              ? {}
              : { endsOn: addDays(today, campaign.endsInDays) }),
            branchId,
            ...(projectId ? { projectId } : {}),
            audienceSummary: campaign.audienceSummary,
            creativeHeadline: campaign.creativeHeadline,
            creativeBody: campaign.creativeBody,
          },
          context,
        );
        if (campaign.state !== 'draft') {
          await service.updateCampaign(
            marketing,
            created.campaignId,
            { state: campaign.state },
            context,
          );
        }
        // Illustrative figures, stored under `demoMetrics` and labelled as such everywhere they are
        // shown. No provider was ever contacted, and there is no publish operation to contact one.
        await service.setDemoMetrics(created.campaignId, {
          impressions: campaign.demoMetrics.impressions,
          reach: campaign.demoMetrics.reach,
          clicks: campaign.demoMetrics.clicks,
          leads: campaign.demoMetrics.leads,
          spend: egp(`${campaign.demoMetrics.spend}.00`),
        });
        return created.campaignId;
      },
    );
    tally(counts, 'campaign', result.created);
  }
}

/* ------------------------------------------------------------------ journeys */

interface JourneySpec {
  key: string;
  leadKey: string;
  ownerKey: 'rep1' | 'rep2';
  unitCode: string;
  /** Percent off the list price. `0` raises no approval request at all. */
  discountPercent: string;
  reservationAmount: string;
  /** Months back from today that the contract was signed. */
  contractedMonthsAgo: number;
  contractedDayOffset: number;
  installmentCount: number;
  downPaymentPercent: string;
  /** How far the customer has paid: full installments, then one partial. */
  fullyPaidInstallments: number;
  partialInstallment?: { sequence: number; percent: string };
  /** Left as a pending approval so the demonstration has something to decide live. */
  stopAtApproval?: boolean;
}

const JOURNEYS: JourneySpec[] = [
  {
    key: 'mona',
    leadKey: 'mona',
    ownerKey: 'rep1',
    unitCode: 'OASIS-A-0302',
    discountPercent: '0',
    reservationAmount: '100000.00',
    contractedMonthsAgo: 6,
    contractedDayOffset: 8,
    installmentCount: 24,
    downPaymentPercent: '20',
    fullyPaidInstallments: 3,
    partialInstallment: { sequence: 4, percent: '50' },
  },
  {
    key: 'walid',
    leadKey: 'walid',
    ownerKey: 'rep2',
    unitCode: 'OASIS-B-0201',
    discountPercent: '3',
    reservationAmount: '75000.00',
    contractedMonthsAgo: 2,
    contractedDayOffset: 5,
    installmentCount: 36,
    downPaymentPercent: '15',
    fullyPaidInstallments: 0,
  },
  {
    // Twelve percent is above the seeded threshold, so this one stops at a pending approval. It is
    // deliberately left undecided: the live demonstration approves it and watches the reservation
    // become confirmable.
    key: 'laila',
    leadKey: 'laila',
    ownerKey: 'rep2',
    unitCode: 'OASIS-A-0504',
    discountPercent: '12',
    reservationAmount: '120000.00',
    contractedMonthsAgo: 0,
    contractedDayOffset: 0,
    installmentCount: 24,
    downPaymentPercent: '20',
    fullyPaidInstallments: 0,
    stopAtApproval: true,
  },
];

async function seedJourneys(
  services: DomainServices,
  actors: DemoActors,
  context: { correlationId: string; method: string; route: string },
  foundation: SeedFoundation,
  unitIds: Map<string, string>,
  leadIds: Map<string, string>,
): Promise<void> {
  const crm = services.crm();
  const sales = services.sales();
  const collections = services.collections();
  const { ledger, counts, today } = foundation;

  for (const journey of JOURNEYS) {
    const rep = journey.ownerKey === 'rep1' ? actors.rep1 : actors.rep2;
    const unitId = unitIds.get(journey.unitCode);
    const leadId = leadIds.get(journey.leadKey);
    if (!unitId || !leadId) throw new Error(`journey ${journey.key} is missing references`);

    const unit = await services.inventory().getUnit(actors.admin, unitId);
    // Pricing is a restricted field (SEC-029), so the contract types it as optional: an actor without
    // `inventory.unit.viewPricing` genuinely receives a unit with no price on it. The seed reads it as
    // the administrator, who holds that permission, and refuses loudly rather than inventing a price.
    const listPrice = unit.currentPrice ?? unit.basePrice;
    if (!listPrice) throw new Error(`unit ${journey.unitCode} has no readable price`);
    const agreedPrice =
      journey.discountPercent === '0'
        ? listPrice
        : subtractMoney(listPrice, percentOf(listPrice, journey.discountPercent));

    const contractedOn = addDays(
      addMonths(today, -journey.contractedMonthsAgo),
      journey.contractedDayOffset,
    );
    const firstDueOn = addMonths(contractedOn, 1);
    const paymentPlan = {
      downPayment: percentOf(agreedPrice, journey.downPaymentPercent),
      installmentCount: journey.installmentCount,
      frequency: 'monthly' as const,
      firstDueOn,
      downPaymentDueOn: contractedOn,
    };

    // The customer record is created from the lead, the same way the sales screen does it, so the
    // demonstration has one person rather than a lead and an unrelated customer with the same name.
    const lead = await crm.getLead(rep, leadId);
    const customer = await crm.ensureCustomerForLead(rep, lead, context);
    // Recorded even though it was created indirectly: the reset works from the ledger, and a customer
    // left behind after a reset would collide with the next seed on the unique phone number.
    await ledger.remember(
      `customer:${journey.key}`,
      C.customers,
      'customerId',
      customer.customerId,
    );

    const reservation = await ledger.ensure(
      `reservation:${journey.key}`,
      C.reservations,
      'reservationId',
      async () => {
        const created = await sales.createReservation(
          rep,
          {
            customerId: customer.customerId,
            leadId,
            unitId,
            reservationAmount: egp(journey.reservationAmount),
            agreedPrice,
            paymentPlan,
            notes: 'حجز تجريبي ضمن بيانات العرض.',
            idempotencyKey: `demo-reservation-${journey.key}`,
          },
          context,
        );
        return created.reservation.reservationId;
      },
    );
    tally(counts, 'reservation', reservation.created);

    if (journey.stopAtApproval) continue;

    const confirmed = await ledger.ensure(
      `reservationConfirmed:${journey.key}`,
      C.reservations,
      'reservationId',
      async () => {
        await sales.confirmReservation(actors.salesManager, reservation.value, context);
        return reservation.value;
      },
    );
    tally(counts, 'reservationConfirmed', confirmed.created);

    const contract = await ledger.ensure(
      `contract:${journey.key}`,
      C.contracts,
      'contractId',
      async () => {
        const created = await sales.createContract(
          actors.salesManager,
          {
            reservationId: reservation.value,
            contractedOn,
            idempotencyKey: `demo-contract-${journey.key}`,
          },
          context,
        );
        return created.contract.contractId;
      },
    );
    tally(counts, 'contract', contract.created);

    await seedCollections(
      { collections, sales },
      actors.collector,
      context,
      foundation,
      journey,
      contract.value,
    );
  }
}

/* -------------------------------------------------------------- collections */

async function seedCollections(
  services: {
    collections: ReturnType<DomainServices['collections']>;
    sales: ReturnType<DomainServices['sales']>;
  },
  collector: ActorContext,
  context: { correlationId: string; method: string; route: string },
  foundation: SeedFoundation,
  journey: JourneySpec,
  contractId: string,
): Promise<void> {
  const { ledger, counts, today } = foundation;
  const installments = await services.sales.listContractInstallments(collector, contractId);
  const ordered = [...installments].sort((a, b) => a.sequence - b.sequence);

  const payments: { key: string; installment: Installment; amount: Money; method: string }[] = [];

  // Amounts are taken from `remainingAmount`, never from `amount`. The reservation deposit is already
  // credited against the down payment by the time the contract exists, so paying the full nominal
  // amount would over-allocate — which the service correctly refuses. Asking the schedule what is
  // still owed is both simpler and the only version that stays right if the credit rules change.
  const downPayment = ordered.find((row) => row.kind === 'downPayment');
  if (downPayment) {
    payments.push({
      key: `${journey.key}-down`,
      installment: downPayment,
      amount: downPayment.remainingAmount,
      method: 'bankTransfer',
    });
  }
  const scheduled = ordered.filter((row) => row.kind === 'installment');
  const methods = ['cash', 'bankTransfer', 'cheque'];
  for (let index = 0; index < journey.fullyPaidInstallments; index += 1) {
    const installment = scheduled[index];
    if (!installment) break;
    payments.push({
      key: `${journey.key}-${installment.sequence}`,
      installment,
      amount: installment.remainingAmount,
      method: methods[index % methods.length] ?? 'cash',
    });
  }
  if (journey.partialInstallment) {
    const installment = scheduled[journey.partialInstallment.sequence - 1];
    if (installment) {
      payments.push({
        key: `${journey.key}-${installment.sequence}-partial`,
        installment,
        amount: percentOf(installment.remainingAmount, journey.partialInstallment.percent),
        method: 'cash',
      });
    }
  }

  for (const payment of payments) {
    // On a rerun the instalment is already settled, so `remainingAmount` is zero and there is nothing
    // to collect. The receipt still exists — it is counted as present rather than silently dropped,
    // so the summary at the end of a rerun adds up to the same totals as the first run.
    if (compareMoney(payment.amount, ZERO) <= 0) {
      tally(counts, 'receipt', false);
      continue;
    }
    const result = await ledger.ensure(
      `receipt:${payment.key}`,
      C.receipts,
      'receiptId',
      async () => {
        const created = await services.collections.recordReceipt(
          collector,
          {
            contractId,
            amount: payment.amount,
            method: payment.method as 'cash',
            // Money is recorded as received on the day it fell due, so the ageing in the
            // demonstration is the ageing the schedule implies.
            receivedOn: payment.installment.dueOn,
            allocations: [
              { installmentId: payment.installment.installmentId, amount: payment.amount },
            ],
            idempotencyKey: `demo-receipt-${payment.key}`,
          },
          context,
        );
        return created.receipt.receiptId;
      },
    );
    tally(counts, 'receipt', result.created);
  }

  // Post-dated cheques and promissory notes against installments that have not fallen due yet: this
  // is the custody register, and it is what a collections team in this market actually holds.
  const future = scheduled.filter((row) => row.dueOn > today).slice(0, 3);
  const kinds = ['cheque', 'promissoryNote', 'cheque'] as const;
  for (const [index, installment] of future.entries()) {
    const kind = kinds[index] ?? 'cheque';
    const result = await ledger.ensure(
      `instrument:${journey.key}-${installment.sequence}`,
      C.instruments,
      'instrumentId',
      async () => {
        const created = await services.collections.createInstrument(
          collector,
          {
            kind,
            instrumentNumber: `DEMO-${journey.key.toUpperCase()}-${String(installment.sequence).padStart(3, '0')}`,
            contractId,
            installmentId: installment.installmentId,
            amount: installment.amount,
            issuedOn: addDays(today, -7),
            dueOn: installment.dueOn,
            bankName: kind === 'cheque' ? 'بنك تجريبي' : undefined,
            drawerName: 'العميل — بيانات تجريبية',
            custodyLocation: 'خزينة الفرع',
          },
          context,
        );
        return created.instrumentId;
      },
    );
    tally(counts, 'instrument', result.created);
  }
}
