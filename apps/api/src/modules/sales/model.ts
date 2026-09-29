import {
  CONTRACT_STATES,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_KINDS,
  INSTALLMENT_STATES,
  RESERVATION_STATES,
} from '@alola/contracts';
import { Schema, type Connection, type Model, type Types } from 'mongoose';

/**
 * Sales storage — `SALE-*` demonstration slice (ADR-0025).
 *
 * Three collections: reservations, contracts, installments. Plus a small counter collection, which is
 * the only place in the system that holds a sequence — a contract number has to be readable and
 * consecutive for the people who file them, and a random identifier is not.
 *
 * **Nothing is deleted.** A cancelled reservation and a cancelled contract stay, with their reason, and
 * an installment is cancelled rather than removed (ADR-0009). The unique indexes are therefore partial
 * wherever a terminal record must not block a new one.
 */
export const RESERVATIONS_COLLECTION = 'salesReservations';
export const CONTRACTS_COLLECTION = 'salesContracts';
export const INSTALLMENTS_COLLECTION = 'salesInstallments';
export const COUNTERS_COLLECTION = 'salesCounters';

export class SalesRecordUndeletableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Sales records are cancelled, never deleted: "${operation}" is refused (ADR-0009).`);
    this.name = 'SalesRecordUndeletableError';
  }
}

export interface StoredMoney {
  amount: Types.Decimal128;
  currency: string;
}

export interface StoredPaymentPlan {
  downPayment: StoredMoney;
  installmentCount: number;
  frequency: (typeof INSTALLMENT_FREQUENCIES)[number];
  firstDueOn: string;
  /**
   * Stored since BMP-1. Before, the plan dropped it, so a contract built from a reservation dated the
   * deposit on the first instalment date — a discovery defect. A plan without it still means "the
   * same day the instalments start", exactly as the contract documents.
   */
  downPaymentDueOn?: string;
  finalPayment?: StoredMoney;
}

export interface ReservationDocument {
  reservationId: string;
  reservationNumber: string;
  customerId: string;
  leadId?: string;
  opportunityId?: string;
  holdId?: string;
  unitId: string;
  projectId: string;
  reservedOn: string;
  expiresOn: string;
  reservationAmount: StoredMoney;
  agreedPrice: StoredMoney;
  listPrice?: StoredMoney;
  discountPercentage: string;
  minimumDeposit?: StoredMoney;
  /** Absent on a record from before BMP-1: none. */
  exceptions?: string[];
  /** Absent on a record from before BMP-1: its `approvalRequestId`, if any, was the discount. */
  approvals?: { operationType: string; requestId: string }[];
  paymentPlan: StoredPaymentPlan;
  salesOwnerAccountId: string;
  legalEntityId: string;
  branchId: string;
  departmentId?: string;
  teamId?: string;
  state: (typeof RESERVATION_STATES)[number];
  approvalRequestId?: string;
  contractId?: string;
  cancellationReason?: string;
  refundHandoff?: 'notApplicable' | 'pending';
  pendingExtension?: { days: number; requestId: string; reason: string };
  pendingCancellation?: { requestId: string; reason: string };
  extensions?: number;
  notes?: string;
  idempotencyKey: string;
  /** Digest of the submission input, so a replay with different input is a conflict, not a no-op. */
  idempotencyFingerprint: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContractDocument {
  contractId: string;
  contractNumber: string;
  customerId: string;
  unitId: string;
  projectId: string;
  reservationId: string;
  contractedOn: string;
  totalPrice: StoredMoney;
  reservationAmount: StoredMoney;
  paymentPlan: StoredPaymentPlan;
  outstandingAmount: StoredMoney;
  paidAmount: StoredMoney;
  salesOwnerAccountId: string;
  legalEntityId: string;
  branchId: string;
  departmentId?: string;
  teamId?: string;
  state: (typeof CONTRACT_STATES)[number];
  cancellationReason?: string;
  documentRef?: string;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstallmentDocument {
  installmentId: string;
  contractId: string;
  customerId: string;
  unitId: string;
  projectId: string;
  sequence: number;
  kind: (typeof INSTALLMENT_KINDS)[number];
  dueOn: string;
  amount: StoredMoney;
  paidAmount: StoredMoney;
  remainingAmount: StoredMoney;
  state: (typeof INSTALLMENT_STATES)[number];
  legalEntityId: string;
  branchId: string;
  teamId?: string;
  salesOwnerAccountId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CounterDocument {
  key: string;
  value: number;
}

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;

const money = new Schema(
  {
    amount: { type: Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true },
  },
  { _id: false },
);

const paymentPlan = new Schema(
  {
    downPayment: { type: money, required: true },
    installmentCount: { type: Number, required: true },
    frequency: { type: String, required: true, enum: [...INSTALLMENT_FREQUENCIES] },
    firstDueOn: { type: String, required: true },
    downPaymentDueOn: { type: String },
    finalPayment: { type: money },
  },
  { _id: false },
);

function refuseDeletion<T>(schema: Schema<T>): Schema<T> {
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new SalesRecordUndeletableError(operation);
    });
  }
  return schema;
}

function reservationSchema(): Schema<ReservationDocument> {
  const schema = new Schema<ReservationDocument>(
    {
      reservationId: { type: String, required: true, immutable: true },
      reservationNumber: { type: String, required: true, immutable: true },
      customerId: { type: String, required: true, immutable: true },
      leadId: { type: String, immutable: true },
      opportunityId: { type: String, immutable: true },
      holdId: { type: String, immutable: true },
      unitId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      reservedOn: { type: String, required: true, immutable: true },
      expiresOn: { type: String, required: true },
      reservationAmount: { type: money, required: true, immutable: true },
      agreedPrice: { type: money, required: true, immutable: true },
      discountPercentage: { type: String, required: true, immutable: true },
      listPrice: { type: money, immutable: true },
      minimumDeposit: { type: money, immutable: true },
      exceptions: { type: [String], immutable: true },
      approvals: {
        type: [
          new Schema(
            {
              operationType: { type: String, required: true },
              requestId: { type: String, required: true },
            },
            { _id: false },
          ),
        ],
      },
      paymentPlan: { type: paymentPlan, required: true },
      salesOwnerAccountId: { type: String, required: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      departmentId: { type: String },
      teamId: { type: String },
      state: { type: String, required: true, enum: [...RESERVATION_STATES] },
      approvalRequestId: { type: String },
      contractId: { type: String },
      cancellationReason: { type: String },
      refundHandoff: { type: String, enum: ['notApplicable', 'pending'] },
      pendingExtension: {
        type: new Schema(
          {
            days: { type: Number, required: true },
            requestId: { type: String, required: true },
            reason: { type: String, required: true },
          },
          { _id: false },
        ),
      },
      pendingCancellation: {
        type: new Schema(
          {
            requestId: { type: String, required: true },
            reason: { type: String, required: true },
          },
          { _id: false },
        ),
      },
      extensions: { type: Number },
      notes: { type: String },
      idempotencyKey: { type: String, required: true, immutable: true },
      idempotencyFingerprint: { type: String, required: true, immutable: true },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: RESERVATIONS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  refuseDeletion(schema);
  schema.index({ reservationId: 1 }, { unique: true, name: 'salesReservations_id_unique' });
  schema.index({ reservationNumber: 1 }, { unique: true, name: 'salesReservations_number_unique' });
  // Idempotent submission: the **database** rejects the second insert, not a read-then-write check.
  schema.index(
    { idempotencyKey: 1 },
    { unique: true, name: 'salesReservations_idempotency_unique' },
  );
  /**
   * One live reservation per unit. Partial, so a cancelled or expired reservation never blocks a new
   * one — which is exactly why nothing has to be deleted to free a unit.
   */
  schema.index(
    { unitId: 1 },
    {
      unique: true,
      name: 'salesReservations_liveUnit_unique',
      partialFilterExpression: { state: { $in: ['draft', 'pendingApproval', 'confirmed'] } },
    },
  );
  schema.index(
    { state: 1, createdAt: -1, reservationId: -1 },
    { name: 'salesReservations_keyset' },
  );
  schema.index({ customerId: 1, createdAt: -1 }, { name: 'salesReservations_customer' });
  schema.index({ salesOwnerAccountId: 1, state: 1 }, { name: 'salesReservations_owner_state' });
  schema.index({ projectId: 1, state: 1 }, { name: 'salesReservations_project_state' });
  schema.index({ legalEntityId: 1, branchId: 1, state: 1 }, { name: 'salesReservations_scope' });
  schema.index({ teamId: 1, state: 1 }, { name: 'salesReservations_scope_team' });
  // The expiry sweep.
  schema.index({ state: 1, expiresOn: 1 }, { name: 'salesReservations_expiry' });
  schema.index({ approvalRequestId: 1 }, { name: 'salesReservations_approval' });
  /**
   * One live reservation per unit, covering the `approved` state added in BMP-1. A new name, because
   * MongoDB refuses to change an existing index's filter in place; the older, narrower index
   * (`salesReservations_liveUnit_unique`) is left in databases that have it, where it is harmless — every
   * reservation it constrains, this one constrains too.
   */
  schema.index(
    { unitId: 1 },
    {
      unique: true,
      name: 'salesReservations_liveUnit_v2_unique',
      partialFilterExpression: {
        state: { $in: ['draft', 'pendingApproval', 'approved', 'confirmed'] },
      },
    },
  );
  schema.index({ 'approvals.requestId': 1 }, { name: 'salesReservations_approvals' });
  schema.index({ opportunityId: 1 }, { name: 'salesReservations_opportunity' });
  return schema;
}

function contractSchema(): Schema<ContractDocument> {
  const schema = new Schema<ContractDocument>(
    {
      contractId: { type: String, required: true, immutable: true },
      // Immutable in the schema, not only in the service: a contract number appears on paper people keep.
      contractNumber: { type: String, required: true, immutable: true },
      customerId: { type: String, required: true, immutable: true },
      unitId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      reservationId: { type: String, required: true, immutable: true },
      contractedOn: { type: String, required: true, immutable: true },
      totalPrice: { type: money, required: true, immutable: true },
      reservationAmount: { type: money, required: true, immutable: true },
      paymentPlan: { type: paymentPlan, required: true },
      outstandingAmount: { type: money, required: true },
      paidAmount: { type: money, required: true },
      salesOwnerAccountId: { type: String, required: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      departmentId: { type: String },
      teamId: { type: String },
      state: { type: String, required: true, enum: [...CONTRACT_STATES] },
      cancellationReason: { type: String },
      documentRef: { type: String },
      idempotencyKey: { type: String, required: true, immutable: true },
      idempotencyFingerprint: { type: String, required: true, immutable: true },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: CONTRACTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  refuseDeletion(schema);
  schema.index({ contractId: 1 }, { unique: true, name: 'salesContracts_id_unique' });
  schema.index({ contractNumber: 1 }, { unique: true, name: 'salesContracts_number_unique' });
  schema.index({ idempotencyKey: 1 }, { unique: true, name: 'salesContracts_idempotency_unique' });
  /** One live contract per reservation, so a retry cannot produce a second contract for one sale. */
  schema.index(
    { reservationId: 1 },
    {
      unique: true,
      name: 'salesContracts_reservation_unique',
      partialFilterExpression: { state: { $in: ['draft', 'active', 'completed'] } },
    },
  );
  schema.index({ state: 1, createdAt: -1, contractId: -1 }, { name: 'salesContracts_keyset' });
  schema.index({ customerId: 1, state: 1 }, { name: 'salesContracts_customer_state' });
  schema.index({ unitId: 1 }, { name: 'salesContracts_unit' });
  schema.index({ projectId: 1, state: 1 }, { name: 'salesContracts_project_state' });
  schema.index({ legalEntityId: 1, branchId: 1, state: 1 }, { name: 'salesContracts_scope' });
  schema.index({ teamId: 1, state: 1 }, { name: 'salesContracts_scope_team' });
  schema.index({ salesOwnerAccountId: 1, state: 1 }, { name: 'salesContracts_owner_state' });
  return schema;
}

function installmentSchema(): Schema<InstallmentDocument> {
  const schema = new Schema<InstallmentDocument>(
    {
      installmentId: { type: String, required: true, immutable: true },
      contractId: { type: String, required: true, immutable: true },
      customerId: { type: String, required: true, immutable: true },
      unitId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      sequence: { type: Number, required: true, immutable: true },
      kind: { type: String, required: true, immutable: true, enum: [...INSTALLMENT_KINDS] },
      dueOn: { type: String, required: true },
      amount: { type: money, required: true },
      paidAmount: { type: money, required: true },
      remainingAmount: { type: money, required: true },
      state: { type: String, required: true, enum: [...INSTALLMENT_STATES] },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      teamId: { type: String },
      salesOwnerAccountId: { type: String, required: true },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: INSTALLMENTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  refuseDeletion(schema);
  schema.index({ installmentId: 1 }, { unique: true, name: 'salesInstallments_id_unique' });
  /** No duplicate sequence within a contract — the schedule is generated once, atomically. */
  schema.index(
    { contractId: 1, sequence: 1 },
    { unique: true, name: 'salesInstallments_contract_sequence_unique' },
  );
  // The three queues a collection officer works from.
  schema.index({ state: 1, dueOn: 1, installmentId: 1 }, { name: 'salesInstallments_queue' });
  schema.index({ dueOn: 1, state: 1 }, { name: 'salesInstallments_due' });
  schema.index({ customerId: 1, dueOn: 1 }, { name: 'salesInstallments_customer_due' });
  schema.index({ contractId: 1, dueOn: 1 }, { name: 'salesInstallments_contract_due' });
  schema.index({ legalEntityId: 1, branchId: 1, state: 1 }, { name: 'salesInstallments_scope' });
  schema.index({ teamId: 1, state: 1 }, { name: 'salesInstallments_scope_team' });
  schema.index({ projectId: 1, state: 1 }, { name: 'salesInstallments_scope_project' });
  schema.index({ salesOwnerAccountId: 1, state: 1 }, { name: 'salesInstallments_owner_state' });
  return schema;
}

function counterSchema(): Schema<CounterDocument> {
  const schema = new Schema<CounterDocument>(
    { key: { type: String, required: true }, value: { type: Number, required: true } },
    { collection: COUNTERS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ key: 1 }, { unique: true, name: 'salesCounters_key_unique' });
  return schema;
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function reservationModel(connection: Connection): Model<ReservationDocument> {
  return model(connection, RESERVATIONS_COLLECTION, reservationSchema);
}

export function contractModel(connection: Connection): Model<ContractDocument> {
  return model(connection, CONTRACTS_COLLECTION, contractSchema);
}

export function installmentModel(connection: Connection): Model<InstallmentDocument> {
  return model(connection, INSTALLMENTS_COLLECTION, installmentSchema);
}

export function counterModel(connection: Connection): Model<CounterDocument> {
  return model(connection, COUNTERS_COLLECTION, counterSchema);
}
