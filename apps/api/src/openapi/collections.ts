import {
  ChangeInstrumentStateSchema,
  CreateInstrumentSchema,
  GenerateRemindersResultSchema,
  GenerateRemindersSchema,
  INSTRUMENT_KINDS,
  INSTRUMENT_STATES,
  InstrumentPageSchema,
  InstrumentSchema,
  PAYMENT_METHODS,
  RECEIPT_STATES,
  REMINDER_STATES,
  ReceiptPageSchema,
  ReceiptSchema,
  RecordReceiptSchema,
  ReminderActionSchema,
  ReminderPageSchema,
  ReminderSchema,
  ReverseReceiptSchema,
} from '@alola/contracts';
import { z } from 'zod';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

/** A reminder page always states whether a provider is connected. It never is (ADR-0026). */
const ReminderPageWithDeliverySchema = z.strictObject({
  ...ReminderPageSchema.shape,
  deliveryConnected: z.boolean(),
});

export const collectionComponents = {
  Receipt: ReceiptSchema,
  ReceiptPage: ReceiptPageSchema,
  RecordReceiptRequest: RecordReceiptSchema,
  ReverseReceiptRequest: ReverseReceiptSchema,
  Instrument: InstrumentSchema,
  InstrumentPage: InstrumentPageSchema,
  CreateInstrumentRequest: CreateInstrumentSchema,
  ChangeInstrumentStateRequest: ChangeInstrumentStateSchema,
  Reminder: ReminderSchema,
  ReminderPage: ReminderPageWithDeliverySchema,
  GenerateRemindersRequest: GenerateRemindersSchema,
  GenerateRemindersResult: GenerateRemindersResultSchema,
  ReminderActionRequest: ReminderActionSchema,
} as const;

export function collectionPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/collections/receipts': {
      get: {
        operationId: 'listReceipts',
        summary: 'List receipts',
        description: "Requires collection.receipt.view. Constrained by the actor's data scope.",
        parameters: [
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 25 }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('contractId', { type: 'string' }),
          queryParameter('customerId', { type: 'string' }),
          queryParameter('projectId', { type: 'string' }),
          queryParameter('method', { type: 'string', enum: [...PAYMENT_METHODS] }),
          queryParameter('state', { type: 'string', enum: [...RECEIPT_STATES] }),
        ],
        responses: { '200': h.json('ReceiptPage', 'A page of receipts'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'recordReceipt',
        summary: 'Record a collection and allocate it to installments',
        description:
          'Requires collection.receipt.create. The allocations and the installment balances they ' +
          'change commit in one transaction. Explicit allocations are honoured; omitting them ' +
          'settles the oldest open installment first. **Over-allocation is refused, never clamped** — ' +
          'a receipt claiming to pay more than is owed is a data-entry error, and absorbing it ' +
          'silently hides both the mistake and the money. Idempotent on the key: a retry returns the ' +
          'original receipt with 200 rather than collecting twice.',
        requestBody: requestBody(h.ref('RecordReceiptRequest')),
        responses: {
          '201': h.json('Receipt', 'The receipt'),
          '200': h.json('Receipt', 'The original receipt, replayed'),
          ...h.conflictErrors,
        },
      },
    },
    '/api/v1/collections/receipts/{receiptId}': {
      get: {
        operationId: 'getReceipt',
        summary: 'Read one receipt',
        description:
          'Requires collection.receipt.view. There is deliberately **no** endpoint that edits a ' +
          'posted receipt: it is a document the customer holds, and a silent edit makes the two ' +
          'copies disagree (ADR-0009). The storage refuses it too, not only the service.',
        parameters: [pathParameter('receiptId', 'Opaque receipt identifier')],
        responses: { '200': h.json('Receipt', 'The receipt'), ...h.notFoundErrors },
      },
    },
    '/api/v1/collections/receipts/{receiptId}/reverse': {
      post: {
        operationId: 'reverseReceipt',
        summary: 'Reverse a posted receipt',
        description:
          'Requires collection.receipt.cancel and a reason. The allocations are put back on their ' +
          'installments in the same transaction, so the contract balance and the receipt state can ' +
          'never disagree. The original receipt stays, marked reversed with its reason.',
        parameters: [pathParameter('receiptId', 'Opaque receipt identifier')],
        requestBody: requestBody(h.ref('ReverseReceiptRequest')),
        responses: { '200': h.json('Receipt', 'The reversed receipt'), ...h.conflictErrors },
      },
    },
    '/api/v1/collections/instruments': {
      get: {
        operationId: 'listInstruments',
        summary: 'List cheques and promissory notes',
        description: 'Requires collection.instrument.view.',
        parameters: [
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 25 }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('kind', { type: 'string', enum: [...INSTRUMENT_KINDS] }),
          queryParameter('state', { type: 'string', enum: [...INSTRUMENT_STATES] }),
          queryParameter('contractId', { type: 'string' }),
          queryParameter('customerId', { type: 'string' }),
          queryParameter('projectId', { type: 'string' }),
        ],
        responses: {
          '200': h.json('InstrumentPage', 'A page of instruments'),
          ...h.authorizedErrors,
        },
      },
      post: {
        operationId: 'createInstrument',
        summary: 'Take custody of a cheque or a promissory note',
        description:
          'Requires collection.instrument.manage. A cheque needs a bank name; a live serial is unique ' +
          'per customer, kind and legal entity, and the uniqueness is partial so a replacement may ' +
          'reuse a cancelled one’s number.',
        requestBody: requestBody(h.ref('CreateInstrumentRequest')),
        responses: { '201': h.json('Instrument', 'The instrument'), ...h.conflictErrors },
      },
    },
    '/api/v1/collections/instruments/{instrumentId}': {
      get: {
        operationId: 'getInstrument',
        summary: 'Read one instrument',
        description: 'Requires collection.instrument.view. Out of scope answers 404 (SEC-030).',
        parameters: [pathParameter('instrumentId', 'Opaque instrument identifier')],
        responses: { '200': h.json('Instrument', 'The instrument'), ...h.notFoundErrors },
      },
    },
    '/api/v1/collections/instruments/{instrumentId}/state': {
      post: {
        operationId: 'changeInstrumentState',
        summary: 'Deposit, present, clear, return, replace or cancel an instrument',
        description:
          'Requires collection.instrument.manage. A cheque is deposited; a promissory note is ' +
          'presented. Returning one **requires** a reason, and a returned instrument is replaced by a ' +
          'new record rather than edited — the original is evidence of what happened. cleared, ' +
          'replaced and cancelled are terminal. A move the machine does not permit is refused and the ' +
          'attempt is audited.',
        parameters: [pathParameter('instrumentId', 'Opaque instrument identifier')],
        requestBody: requestBody(h.ref('ChangeInstrumentStateRequest')),
        responses: { '200': h.json('Instrument', 'The updated instrument'), ...h.conflictErrors },
      },
    },
    '/api/v1/collections/reminders': {
      get: {
        operationId: 'listReminders',
        summary: 'The reminder centre',
        description:
          'Requires collection.reminder.view. Every response carries **deliveryConnected: false**: ' +
          'no WhatsApp Business account, no approved template and no provider is configured, so a ' +
          'reminder here has reached nobody (ADR-0026).',
        parameters: [
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 50 }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('state', { type: 'string', enum: [...REMINDER_STATES] }),
          queryParameter('contractId', { type: 'string' }),
          queryParameter('customerId', { type: 'string' }),
          queryParameter('projectId', { type: 'string' }),
        ],
        responses: { '200': h.json('ReminderPage', 'A page of reminders'), ...h.authorizedErrors },
      },
    },
    '/api/v1/collections/reminders/generate': {
      post: {
        operationId: 'generateReminders',
        summary: 'Create reminders for installments falling due inside the window',
        description:
          'Requires collection.reminder.manage. **Idempotent by unique index** on (installment, due ' +
          'date, channel), not by a read-then-write check: a second sweep on the same day inserts ' +
          'nothing, which is what stops a customer receiving the same reminder twice. Nothing is ' +
          'delivered; the message is composed in Arabic and English so it can be previewed.',
        requestBody: requestBody(h.ref('GenerateRemindersRequest')),
        responses: {
          '200': h.json('GenerateRemindersResult', 'How many were created and how many existed'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/collections/reminders/{reminderId}': {
      get: {
        operationId: 'getReminder',
        summary: 'Read one reminder, including its Arabic and English message',
        description: 'Requires collection.reminder.view.',
        parameters: [pathParameter('reminderId', 'Opaque reminder identifier')],
        responses: { '200': h.json('Reminder', 'The reminder'), ...h.notFoundErrors },
      },
    },
    '/api/v1/collections/reminders/{reminderId}/act': {
      post: {
        operationId: 'actOnReminder',
        summary: 'Move a reminder to ready, simulated, or failed',
        description:
          'Requires collection.reminder.manage. `simulated` is a state of its own and is **not** a ' +
          'synonym for sent: the simulated adapter records that a message would have been delivered ' +
          'and reaches nobody. Asking for it with no adapter configured is refused rather than faked, ' +
          'because with nothing behind the port there is no simulation either (ADR-0026).',
        parameters: [pathParameter('reminderId', 'Opaque reminder identifier')],
        requestBody: requestBody(h.ref('ReminderActionRequest')),
        responses: { '200': h.json('Reminder', 'The updated reminder'), ...h.conflictErrors },
      },
    },
  };
}
