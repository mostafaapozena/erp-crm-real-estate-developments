import type { loadApiConfig } from '@alola/config';
import {
  DevKeyEncryptor,
  LocalDiskFileStore,
  PasswordHasher,
  TokenIssuer,
  UnconfiguredEncryptor,
  UnconfiguredFileStore,
  UnconfiguredMalwareScanner,
  type Encryptor,
  type Logger,
  type PrivateFileStore,
} from '@alola/security';
import { DOCUMENT_MAX_BYTES } from '@alola/contracts';
import { resolve } from 'node:path';
import { businessDateInZone, nowInstant } from '@alola/contracts';
import type { Connection } from 'mongoose';
import type { Redis } from 'ioredis';
import { ApprovalService, NoApplicablePolicyError } from '../modules/approval';
import { AuditService } from '../modules/audit';
import { CollectionService } from '../modules/collections';
import { CompanyService } from '../modules/company';
import { DocumentService, TemplateService, type OwnerResolver } from '../modules/documents';
import { CrmService } from '../modules/crm';
import { AuthThrottle, IdentityService } from '../modules/identity';
import { InventoryService } from '../modules/inventory';
import { MarketingService } from '../modules/marketing';
import { NumberingService } from '../modules/numbering';
import {
  NotificationService,
  SimulatedChannelAdapter,
  type ChannelAdapter,
} from '../modules/notifications';
import { NotificationReminderDelivery } from './reminder-delivery';
import { APPROVAL_AUDIT_ACTIONS } from '@alola/contracts';
import { OrganizationService } from '../modules/organization';
import { SalesService } from '../modules/sales';
import { SecurityService } from '../modules/security';
import { SettingsService } from '../modules/settings';
import { AppError } from '../errors';

/**
 * The composition root for the domain services.
 *
 * This lives apart from `main.ts` for one reason: **the demonstration seed must write through the same
 * service graph the running API uses.** A seed that wires its own copy drifts — a port added here and
 * forgotten there produces seeded data that no endpoint could have produced, and the demonstration then
 * proves something the product does not do.
 *
 * Everything is lazy. A service is built the first time it is asked for, so nothing requires a database
 * connection at import time and the API can answer `SERVICE_NOT_CONFIGURED` rather than crash (ADR-0012).
 *
 * The ports wired below are the module boundary (ADR-0001): inventory does not import `CORE-ORG`, sales
 * does not import inventory, collections does not import sales. Each asks for the one fact it needs
 * through a function supplied here, which keeps the dependency visible at the root instead of buried in
 * a call chain.
 */
export interface DomainServiceOptions {
  config: ReturnType<typeof loadApiConfig>;
  logger: Logger;
  /** Throws when no database is available, so no service is ever built against a dead connection. */
  requireConnection: () => Connection;
  /** Absent falls back to in-process throttling — correct for a single node, not for a cluster. */
  redisClient?: Redis | undefined;
  /** Called after every audit write; the API uses it to enforce `AUDIT-003` per request. */
  onAuditRecorded?: (() => void) | undefined;
  /**
   * The repository root, for resolving the development file store. Supplied by the entry point, which
   * knows where it runs from — a bundled build sits at a different depth than the source.
   */
  repositoryRoot?: string | undefined;
}

export interface DomainServices {
  audit: () => AuditService;
  security: () => SecurityService;
  identity: () => IdentityService;
  approval: () => ApprovalService;
  organization: () => OrganizationService;
  inventory: () => InventoryService;
  crm: () => CrmService;
  sales: () => SalesService;
  collections: () => CollectionService;
  marketing: () => MarketingService;
  company: () => CompanyService;
  settings: () => SettingsService;
  numbering: () => NumberingService;
  documents: () => DocumentService;
  templates: () => TemplateService;
  notifications: () => NotificationService;
  /** The private file store; a `LocalDiskFileStore` only in development and test. */
  fileStore: PrivateFileStore;
}

export function createDomainServices(options: DomainServiceOptions): DomainServices {
  const { config, logger, requireConnection } = options;

  let auditService: AuditService | undefined;
  let securityService: SecurityService | undefined;
  let identityService: IdentityService | undefined;
  let approvalService: ApprovalService | undefined;
  let organizationService: OrganizationService | undefined;
  let inventoryService: InventoryService | undefined;
  let crmService: CrmService | undefined;
  let salesService: SalesService | undefined;
  let collectionService: CollectionService | undefined;
  let marketingService: MarketingService | undefined;
  let companyService: CompanyService | undefined;
  let settingsService: SettingsService | undefined;
  let numberingService: NumberingService | undefined;
  let documentService: DocumentService | undefined;
  let templateService: TemplateService | undefined;
  let notificationService: NotificationService | undefined;

  /**
   * Encryption for MFA secrets (`SEC-017`).
   *
   * `SEC-033` (a KMS adapter) is **not implemented**. When `KMS_KEY_ID` is set the unconfigured encryptor
   * fails loudly rather than pretending a managed key is in use; development and test use a configured
   * local key so that an enrolment survives a restart (ADR-0023).
   */
  function buildEncryptor(): Encryptor {
    if (!config.KMS_KEY_ID && config.DEV_ENCRYPTION_KEY) {
      return new DevKeyEncryptor(config.APP_ENV, config.DEV_ENCRYPTION_KEY);
    }
    return new UnconfiguredEncryptor();
  }

  const passwordHasher = new PasswordHasher({
    memoryCost: config.ARGON2_MEMORY_COST,
    timeCost: config.ARGON2_TIME_COST,
    parallelism: config.ARGON2_PARALLELISM,
  });
  const authThrottle = new AuthThrottle(options.redisClient ?? undefined);

  /**
   * Private file storage (PLAT-017). Development and test keep files on the local disk behind signed,
   * expiring links; staging and production need private object storage, whose adapter is not built
   * yet — so there the store refuses loudly rather than writing to a server's disk (ADR-0012).
   */
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const fileStore: PrivateFileStore =
    config.APP_ENV === 'development' || config.APP_ENV === 'test'
      ? new LocalDiskFileStore(
          config.APP_ENV,
          resolve(repositoryRoot, config.FILE_STORAGE_DIR ?? '.local-storage'),
        )
      : new UnconfiguredFileStore();

  function getAuditService(): AuditService {
    const connection = requireConnection();
    auditService ??= new AuditService({
      connection,
      logger,
      ...(options.onAuditRecorded ? { onRecorded: options.onAuditRecorded } : {}),
    });
    return auditService;
  }

  function getSecurityService(): SecurityService {
    const connection = requireConnection();
    securityService ??= new SecurityService({ connection, audit: getAuditService() });
    return securityService;
  }

  /**
   * The deployment's company profile (PLAT-022, ADR-0027). Every other module reads the company
   * through this service — the authenticator issuer, a document's letterhead — never its collections.
   */
  function getCompanyService(): CompanyService {
    const connection = requireConnection();
    companyService ??= new CompanyService({
      connection,
      audit: getAuditService(),
      defaultLocale: config.DEFAULT_LOCALE,
      demonstration: config.APP_ENV === 'development' || config.APP_ENV === 'test',
      timeZone: config.ORG_TIMEZONE,
    });
    return companyService;
  }

  /** Settings, reference data and feature flags (PLAT-024 … PLAT-026). */
  function getSettingsService(): SettingsService {
    const connection = requireConnection();
    settingsService ??= new SettingsService({ connection, audit: getAuditService() });
    return settingsService;
  }

  /**
   * Number sequences (CORE-DOC-001). The fiscal year comes from the deployment's settings; a
   * fiscal-year format refuses to issue until it is configured (`SD-21`) rather than guessing January.
   */
  function getNumberingService(): NumberingService {
    const connection = requireConnection();
    numberingService ??= new NumberingService({
      connection,
      audit: getAuditService(),
      fiscalYearStartMonth: () =>
        getSettingsService().valueOf<number>('finance.fiscalYearStartMonth'),
    });
    return numberingService;
  }

  /**
   * A document is exactly as visible as the record it belongs to. Each owner type resolves through its
   * module's **scoped** getter, so a record outside the actor's scope is not found and nothing is
   * attached to it; the placement returned is what the document's own scope filter then uses.
   */
  const resolveOwner: OwnerResolver = async (actor, type, id) => {
    switch (type) {
      case 'lead': {
        const lead = await getCrmService().getLead(actor, id);
        return {
          legalEntityId: lead.legalEntityId,
          branchId: lead.branchId,
          departmentId: lead.departmentId,
          teamId: lead.teamId,
          ownerAccountId: lead.assignedToAccountId,
        };
      }
      case 'customer': {
        const customer = await getCrmService().getCustomer(actor, id);
        return {
          legalEntityId: customer.legalEntityId,
          branchId: customer.branchId,
          ownerAccountId: customer.ownerAccountId,
        };
      }
      case 'project': {
        const project = await getInventoryService().getProject(actor, id);
        return {
          legalEntityId: project.legalEntityId,
          branchId: project.branchId,
          projectId: project.projectId,
        };
      }
      case 'unit': {
        const unit = await getInventoryService().getUnit(actor, id);
        return {
          legalEntityId: unit.legalEntityId,
          branchId: unit.branchId,
          projectId: unit.projectId,
        };
      }
      case 'reservation': {
        const reservation = await getSalesService().getReservation(actor, id);
        return {
          legalEntityId: reservation.legalEntityId,
          branchId: reservation.branchId,
          departmentId: reservation.departmentId,
          teamId: reservation.teamId,
          projectId: reservation.projectId,
          ownerAccountId: reservation.salesOwnerAccountId,
        };
      }
      case 'contract': {
        const contract = await getSalesService().getContract(actor, id);
        return {
          legalEntityId: contract.legalEntityId,
          branchId: contract.branchId,
          departmentId: contract.departmentId,
          teamId: contract.teamId,
          projectId: contract.projectId,
          ownerAccountId: contract.salesOwnerAccountId,
        };
      }
      case 'receipt': {
        const receipt = await getCollectionService().getReceipt(actor, id);
        return {
          legalEntityId: receipt.legalEntityId,
          branchId: receipt.branchId,
          teamId: receipt.teamId,
          projectId: receipt.projectId,
          ownerAccountId: receipt.receivedByAccountId,
        };
      }
      case 'company':
        // Deployment-wide papers — the company's own registrations — for the all scope only.
        return actor.scope.level === 'all' ? { legalEntityId: 'deployment' } : undefined;
    }
  };

  /** Documents (CORE-DOC-004, CORE-DOC-006). No scanner is selected yet: files are `not_scanned`. */
  function getDocumentService(): DocumentService {
    const connection = requireConnection();
    documentService ??= new DocumentService({
      connection,
      audit: getAuditService(),
      store: fileStore,
      scanner: new UnconfiguredMalwareScanner(),
      resolveOwner,
      maxBytes: DOCUMENT_MAX_BYTES,
    });
    return documentService;
  }

  /** Templates (CORE-DOC-002). No wording ships with the product (`SD-10`). */
  function getTemplateService(): TemplateService {
    const connection = requireConnection();
    templateService ??= new TemplateService({ connection, audit: getAuditService() });
    return templateService;
  }

  /**
   * External channels (CORE-NOTIFY-002). **None is connected** (`SD-20`): development and test
   * simulate e-mail, SMS and WhatsApp — every message ends `simulated`, reaching nobody — and every
   * other environment has no adapter at all, so a message there is `undeliverable`.
   */
  const channelAdapters: Partial<Record<'email' | 'sms' | 'whatsapp', ChannelAdapter>> =
    config.APP_ENV === 'development' || config.APP_ENV === 'test'
      ? {
          email: new SimulatedChannelAdapter('email', config.APP_ENV),
          sms: new SimulatedChannelAdapter('sms', config.APP_ENV),
          whatsapp: new SimulatedChannelAdapter('whatsapp', config.APP_ENV),
        }
      : {};

  /** Notifications (CORE-NOTIFY-001 … 005), configured from the deployment's settings. */
  function getNotificationService(): NotificationService {
    const connection = requireConnection();
    notificationService ??= new NotificationService({
      connection,
      audit: getAuditService(),
      logger,
      timeZone: config.ORG_TIMEZONE,
      defaultLocale: config.DEFAULT_LOCALE,
      adapters: channelAdapters,
      isActiveAccount: async (accountId) => {
        try {
          return (await getIdentityService().getAccount(accountId)).state === 'active';
        } catch {
          return false;
        }
      },
      externalDeliveryEnabled: () =>
        getSettingsService().isEnabled('feature.notifications.externalDelivery'),
      quietHours: () =>
        getSettingsService().valueOf<{ start: string; end: string }>('notifications.quietHours'),
    });
    return notificationService;
  }

  function getOrganizationService(): OrganizationService {
    const connection = requireConnection();
    organizationService ??= new OrganizationService({
      connection,
      audit: getAuditService(),
      // Placements are effective-dated in the organization's calendar, not the server's (ADR-0008).
      today: () => businessDateInZone(nowInstant(), config.ORG_TIMEZONE),
    });
    return organizationService;
  }

  /**
   * Inventory takes `CORE-ORG` as a **port** rather than importing it: it needs exactly one fact about a
   * branch — which legal entity it belongs to — and wiring that here keeps the dependency visible at the
   * composition root instead of buried inside a call chain.
   */
  function getInventoryService(): InventoryService {
    const connection = requireConnection();
    inventoryService ??= new InventoryService({
      connection,
      audit: getAuditService(),
      resolveBranch: (branchId) => getOrganizationService().findBranch(branchId),
    });
    return inventoryService;
  }

  /**
   * CRM. "Today" is the calendar date in the **organization** timezone, not the server's (ADR-0008):
   * a follow-up due today must mean today where the sales team is, and a business date is never
   * converted through a timezone once it is stored.
   */
  function getCrmService(): CrmService {
    const connection = requireConnection();
    crmService ??= new CrmService({
      connection,
      audit: getAuditService(),
      resolveBranch: (branchId) => getOrganizationService().findBranch(branchId),
      today: () => businessDateInZone(nowInstant(), config.ORG_TIMEZONE),
    });
    return crmService;
  }

  /**
   * The approval engine (`APPROVAL-001` … `APPROVAL-007`).
   *
   * `resolveManager` is now wired to `CORE-ORG`, so an overdue stage escalates to the requester's direct
   * manager when the reporting line resolves to an active placement with a system login. When it does
   * not — no manager, an inactive manager, or a manager with no account — the sweep still reports the
   * stage as **unresolved** rather than inventing an approver (`APPROVAL-005`, ADR-0024).
   *
   * `events` publishes to `CORE-NOTIFY` (F6). The engine is still correct with nothing listening: a
   * publication failure is logged and swallowed after the decision has committed.
   */
  function getApprovalService(): ApprovalService {
    const connection = requireConnection();
    approvalService ??= new ApprovalService({
      connection,
      logger,
      audit: getAuditService(),
      accountsWithPermission: (permission) =>
        getSecurityService().accountsWithPermission(permission),
      resolveActor: (accountId) => getSecurityService().resolveActor(accountId),
      resolveManager: (accountId) => getOrganizationService().resolveManagerAccount(accountId),
      // CORE-NOTIFY: who owes a decision is told; an escalation tells the manager; the requester
      // learns the outcome. Deduplicated per request and stage, so a replayed event notifies nobody twice.
      events: {
        publish: async (event) => {
          const notifications = getNotificationService();
          const params = { requestId: event.requestId };
          if (event.action === APPROVAL_AUDIT_ACTIONS.requestEscalated) {
            await notifications.notify({
              type: 'approval.escalated',
              recipients: { accountIds: event.pendingApproverAccountIds },
              params,
              source: { type: 'approvalRequest', id: event.requestId },
              dedupeKey: `approval:${event.requestId}:${event.stageOrder}:escalated`,
            });
          } else if (event.state === 'pending') {
            await notifications.notify({
              type: 'approval.pending',
              recipients: { accountIds: event.pendingApproverAccountIds },
              params,
              source: { type: 'approvalRequest', id: event.requestId },
              dedupeKey: `approval:${event.requestId}:${event.stageOrder}:pending`,
            });
          } else if (event.requesterAccountId) {
            await notifications.notify({
              type: 'approval.decided',
              recipients: { accountIds: [event.requesterAccountId] },
              params,
              source: { type: 'approvalRequest', id: event.requestId },
              dedupeKey: `approval:${event.requestId}:decided:${event.state}`,
            });
          }
        },
      },
    });
    return approvalService;
  }

  /**
   * Sales. Three ports are wired here rather than imported inside the module:
   *
   * - `units` — inventory owns the unit state machine, and sales asks it to move a unit inside the
   *   sales transaction, so a hold and the reservation that took it commit together.
   * - `crm` — the customer behind a reservation, and the lead's pipeline stage.
   * - `approvals` — the discount control. The engine records a decision and never performs the
   *   operation, so sales observes the outcome and acts (ADR-0024 §2). With no policy configured,
   *   `submit` resolves to nothing and the reservation is an ordinary draft: the **absence** of a
   *   control is not an approval.
   */
  function getSalesService(): SalesService {
    const connection = requireConnection();
    salesService ??= new SalesService({
      connection,
      logger,
      audit: getAuditService(),
      units: {
        find: async (unitId, session) => {
          const unit = await getInventoryService().findUnitForUpdate(unitId, session);
          return unit
            ? {
                unitId: unit.unitId,
                projectId: unit.projectId,
                legalEntityId: unit.legalEntityId,
                branchId: unit.branchId,
                code: unit.code,
                status: unit.status,
                ...(unit.currentPrice ? { currentPrice: unit.currentPrice } : {}),
              }
            : undefined;
        },
        changeStatus: (actor, change, context, session) =>
          getInventoryService().applyStatusChange(
            actor,
            change as Parameters<InventoryService['applyStatusChange']>[1],
            context,
            session,
          ),
      },
      crm: {
        findCustomer: async (customerId, session) => {
          const customer = await getCrmService().findCustomerUnscoped(customerId, session);
          return customer
            ? { customerId: customer.customerId, legalEntityId: customer.legalEntityId }
            : undefined;
        },
        advanceLead: (actor, leadId, to, reason, context, session) =>
          getCrmService().advanceStageInternal(actor, leadId, to, reason, context, session),
      },
      approvals: {
        submit: async (actor, input, context) => {
          try {
            const result = await getApprovalService().submit(actor, input, context);
            return { requestId: result.request.requestId, state: result.request.state };
          } catch (error) {
            // No policy configured for this operation is the normal case until `SD-02` supplies one.
            if (error instanceof NoApplicablePolicyError) return undefined;
            throw error;
          }
        },
        state: async (requestId) => {
          try {
            return (await getApprovalService().findRequestOutcome(requestId))?.state;
          } catch {
            return undefined;
          }
        },
      },
      today: () => businessDateInZone(nowInstant(), config.ORG_TIMEZONE),
    });
    return salesService;
  }

  /**
   * Collections.
   *
   * The delivery port is configured with the **simulated** adapter in development and test, and with
   * nothing anywhere else. There is no WhatsApp Business account, no approved template and no selected
   * provider (`SD-20`), so a connected adapter would be a fiction. The reminder centre is correct with
   * nothing behind the port: reminders are still generated, listed, previewed and audited — they simply
   * stay `ready`, and every response says `deliveryConnected: false` (ADR-0026).
   *
   * Receipt numbering shares the sales counter, so the two series are produced by one mechanism rather
   * than two that can drift.
   */
  function getCollectionService(): CollectionService {
    const connection = requireConnection();
    collectionService ??= new CollectionService({
      connection,
      logger,
      audit: getAuditService(),
      sales: {
        findContract: async (contractId, session) => {
          const contract = await getSalesService().findContract(contractId, session);
          return contract
            ? {
                contractId: contract.contractId,
                contractNumber: contract.contractNumber,
                customerId: contract.customerId,
                unitId: contract.unitId,
                projectId: contract.projectId,
                legalEntityId: contract.legalEntityId,
                branchId: contract.branchId,
                ...(contract.teamId ? { teamId: contract.teamId } : {}),
                salesOwnerAccountId: contract.salesOwnerAccountId,
                state: contract.state,
                totalPrice: contract.totalPrice,
              }
            : undefined;
        },
        listOpenInstallments: (contractId, session) =>
          getSalesService().listOpenInstallments(contractId, session),
        applyPaymentToInstallment: (installmentId, amount, session) =>
          getSalesService().applyPaymentToInstallment(installmentId, amount, session),
        reversePaymentOnInstallment: (installmentId, amount, session) =>
          getSalesService().reversePaymentOnInstallment(installmentId, amount, session),
        recomputeContractTotals: (contractId, session) =>
          getSalesService().recomputeContractTotals(contractId, session),
        listInstallmentsDueWithin: (from, to) =>
          getSalesService().listInstallmentsDueWithin(from, to),
      },
      customers: {
        find: async (customerId) => {
          const customer = await getCrmService().findCustomerUnscoped(customerId);
          return customer ? { customerId: customer.customerId, name: customer.name } : undefined;
        },
      },
      units: {
        find: async (unitId) => {
          const unit = await getInventoryService().findUnitForUpdate(unitId);
          return unit ? { unitId: unit.unitId, code: unit.code } : undefined;
        },
      },
      // Reminders are delivered through the notification foundation. In development and test its
      // channels are simulated; elsewhere no delivery is configured, and a reminder stays `ready`.
      ...(config.APP_ENV === 'development' || config.APP_ENV === 'test'
        ? {
            delivery: new NotificationReminderDelivery(
              getNotificationService,
              (channel) => channelAdapters[channel]?.connected ?? false,
            ),
          }
        : {}),
      today: () => businessDateInZone(nowInstant(), config.ORG_TIMEZONE),
      timeZone: config.ORG_TIMEZONE,
      nextReceiptNumber: (session) => getSalesService().allocateNumber('RCT', session),
    });
    return collectionService;
  }

  /**
   * Marketing. No provider adapter is wired, because none exists and none may be invented: there is no
   * publish operation to wire it to (ADR-0026).
   */
  function getMarketingService(): MarketingService {
    const connection = requireConnection();
    marketingService ??= new MarketingService({
      connection,
      audit: getAuditService(),
      resolveBranch: (branchId) => getOrganizationService().findBranch(branchId),
    });
    return marketingService;
  }

  /**
   * Authentication needs a signing key. Without one the routes answer `SERVICE_NOT_CONFIGURED` exactly as
   * they do without a database, instead of falling back to a built-in key (ADR-0012, ADR-0023).
   */
  function getIdentityService(): IdentityService {
    const connection = requireConnection();
    if (!config.AUTH_TOKEN_SIGNING_SECRET) {
      throw new AppError('SERVICE_NOT_CONFIGURED', 503);
    }
    identityService ??= new IdentityService({
      connection,
      logger,
      audit: getAuditService(),
      hasher: passwordHasher,
      tokens: new TokenIssuer({
        secret: config.AUTH_TOKEN_SIGNING_SECRET,
        issuer: 'alola-erp-api',
        audience: 'alola-erp',
        accessTokenTtlSeconds: config.AUTH_ACCESS_TOKEN_TTL_SECONDS,
        mfaChallengeTtlSeconds: config.AUTH_MFA_CHALLENGE_TTL_SECONDS,
      }),
      encryptor: buildEncryptor(),
      throttle: authThrottle,
      // Grants come from the SEC authorization module; identity never reads that storage itself.
      resolveGrants: (accountId) => getSecurityService().resolveActor(accountId),
      ttl: {
        sessionIdleSeconds: config.AUTH_SESSION_IDLE_TIMEOUT_SECONDS,
        sessionAbsoluteSeconds: config.AUTH_SESSION_ABSOLUTE_TIMEOUT_SECONDS,
        activationSeconds: config.AUTH_ACTIVATION_TOKEN_TTL_SECONDS,
        passwordResetSeconds: config.AUTH_PASSWORD_RESET_TTL_SECONDS,
      },
      totpIssuer: config.AUTH_TOTP_ISSUER,
      resolveTotpIssuer: () => getCompanyService().authenticatorIssuer(),
    });
    return identityService;
  }

  return {
    audit: getAuditService,
    security: getSecurityService,
    identity: getIdentityService,
    approval: getApprovalService,
    organization: getOrganizationService,
    inventory: getInventoryService,
    crm: getCrmService,
    sales: getSalesService,
    collections: getCollectionService,
    marketing: getMarketingService,
    company: getCompanyService,
    settings: getSettingsService,
    numbering: getNumberingService,
    documents: getDocumentService,
    templates: getTemplateService,
    notifications: getNotificationService,
    fileStore,
  };
}
