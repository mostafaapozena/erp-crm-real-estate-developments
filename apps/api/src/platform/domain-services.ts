import type { loadApiConfig } from '@alola/config';
import {
  DevKeyEncryptor,
  LocalDiskFileStore,
  PasswordHasher,
  TokenIssuer,
  UnconfiguredEncryptor,
  UnconfiguredFileStore,
  UnconfiguredMalwareScanner,
  effectivePermissions,
  type Encryptor,
  type Logger,
  type PrivateFileStore,
} from '@alola/security';
import { ContractHistorySchema, DOCUMENT_MAX_BYTES } from '@alola/contracts';
import { resolve } from 'node:path';
import { businessDateInZone, nowInstant, type LocalizedLabel } from '@alola/contracts';
import type { Connection } from 'mongoose';
import type { Redis } from 'ioredis';
import { ApprovalService, NoApplicablePolicyError } from '../modules/approval';
import { AuditService } from '../modules/audit';
import { CollectionService } from '../modules/collections';
import { CompanyService } from '../modules/company';
import { DocumentService, TemplateService, type OwnerResolver } from '../modules/documents';
import { CrmService, OpportunityService, leadImporter } from '../modules/crm';
import { AuthThrottle, IdentityService } from '../modules/identity';
import {
  HoldService,
  InventoryService,
  PlanTemplateService,
  PriceService,
  type InventoryApprovalPort,
} from '../modules/inventory';
import { MAINTENANCE_ACTOR } from './maintenance';
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
import { QuotationService, SalesService, type DepositRule } from '../modules/sales';
import { IssuanceService, type LoadedSource } from '../modules/issuance';
import { withTransaction } from './transactions';
import { SecurityService } from '../modules/security';
import { SettingsService, referenceItemImporter } from '../modules/settings';
import { ImportService, readFirstSheet } from '../modules/imports';
import { IntegrationService } from '../modules/integrations';
import { TaskService } from '../modules/tasks';
import { SearchService, type SearchProvider } from '../modules/search';
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
  prices: () => PriceService;
  holds: () => HoldService;
  planTemplates: () => PlanTemplateService;
  crm: () => CrmService;
  opportunities: () => OpportunityService;
  sales: () => SalesService;
  quotations: () => QuotationService;
  issuance: () => IssuanceService;
  collections: () => CollectionService;
  marketing: () => MarketingService;
  company: () => CompanyService;
  settings: () => SettingsService;
  numbering: () => NumberingService;
  documents: () => DocumentService;
  templates: () => TemplateService;
  notifications: () => NotificationService;
  tasks: () => TaskService;
  search: () => SearchService;
  imports: () => ImportService;
  integrations: () => IntegrationService;
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
  let priceService: PriceService | undefined;
  let holdService: HoldService | undefined;
  let planTemplateService: PlanTemplateService | undefined;
  let crmService: CrmService | undefined;
  let opportunityService: OpportunityService | undefined;
  let salesService: SalesService | undefined;
  let quotationService: QuotationService | undefined;
  let issuanceService: IssuanceService | undefined;
  let collectionService: CollectionService | undefined;
  let marketingService: MarketingService | undefined;
  let companyService: CompanyService | undefined;
  let settingsService: SettingsService | undefined;
  let numberingService: NumberingService | undefined;
  let documentService: DocumentService | undefined;
  let templateService: TemplateService | undefined;
  let notificationService: NotificationService | undefined;
  let taskService: TaskService | undefined;
  let searchService: SearchService | undefined;
  let importService: ImportService | undefined;
  let integrationService: IntegrationService | undefined;

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
  const authThrottle = new AuthThrottle(options.redisClient ?? undefined, {
    loginByIpPoints: config.AUTH_LOGIN_IP_MAX_ATTEMPTS,
  });

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
      case 'building': {
        const building = await getInventoryService().getBuilding(actor, id);
        return {
          legalEntityId: building.legalEntityId,
          branchId: building.branchId,
          projectId: building.projectId,
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
      case 'quotation': {
        const [latest] = (await getQuotationService().revisions(actor, id)).items;
        return latest
          ? {
              legalEntityId: latest.legalEntityId,
              branchId: latest.branchId,
              departmentId: latest.departmentId,
              teamId: latest.teamId,
              projectId: latest.projectId,
              ownerAccountId: latest.salesOwnerAccountId,
            }
          : undefined;
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
      // A customer's consent is the CRM's record (CRM-PERSON-003); without it nothing external is sent.
      hasConsent: (customerId, channel) => getCrmService().hasConsent(customerId, channel),
      quietHours: () =>
        getSettingsService().valueOf<{ start: string; end: string }>('notifications.quietHours'),
    });
    return notificationService;
  }

  /**
   * Tasks (CORE-TASK-001 … 005). A linked task resolves its record through the same scoped getters a
   * document does, so a task is exactly as visible as the record it is about; escalation follows the
   * `CORE-ORG` reporting line, and every notice goes through `CORE-NOTIFY`.
   */
  function getTaskService(): TaskService {
    const connection = requireConnection();
    taskService ??= new TaskService({
      connection,
      audit: getAuditService(),
      timeZone: config.ORG_TIMEZONE,
      resolveLink: (actor, type, id) => resolveOwner(actor, type, id),
      isActiveAccount: async (accountId) => {
        try {
          return (await getIdentityService().getAccount(accountId)).state === 'active';
        } catch {
          return false;
        }
      },
      resolveManager: (accountId) => getOrganizationService().resolveManagerAccount(accountId),
      escalationDelayHours: () =>
        getSettingsService().valueOf<number>('tasks.escalationDelayHours'),
      notifier: getNotificationService(),
    });
    return taskService;
  }

  /**
   * Global search (CORE-SEARCH-001). Each provider is the owning module's own scoped search, called
   * only when the actor holds that module's read permission; the search service holds no data.
   */
  function getSearchService(): SearchService {
    const tag =
      <T extends SearchProvider['type']>(type: T) =>
      (hits: { id: string; label: string; name?: { ar: string; en: string }; status?: string }[]) =>
        hits.map((hit) => ({ type, ...hit }));
    const providers: SearchProvider[] = [
      {
        type: 'lead',
        permission: 'crm.lead.view',
        search: async (actor, term, limit) =>
          tag('lead')(await getCrmService().searchLeads(actor, term, limit)),
      },
      {
        type: 'customer',
        permission: 'crm.customer.view',
        search: async (actor, term, limit) =>
          tag('customer')(await getCrmService().searchCustomers(actor, term, limit)),
      },
      {
        type: 'project',
        permission: 'inventory.project.view',
        search: async (actor, term, limit) =>
          tag('project')(await getInventoryService().searchProjects(actor, term, limit)),
      },
      {
        type: 'unit',
        permission: 'inventory.unit.view',
        search: async (actor, term, limit) =>
          tag('unit')(await getInventoryService().searchUnits(actor, term, limit)),
      },
      {
        type: 'reservation',
        permission: 'sales.reservation.view',
        search: async (actor, term, limit) =>
          tag('reservation')(await getSalesService().searchReservations(actor, term, limit)),
      },
      {
        type: 'contract',
        permission: 'sales.contract.view',
        search: async (actor, term, limit) =>
          tag('contract')(await getSalesService().searchContracts(actor, term, limit)),
      },
      {
        type: 'receipt',
        permission: 'collection.receipt.view',
        search: async (actor, term, limit) =>
          tag('receipt')(await getCollectionService().searchReceipts(actor, term, limit)),
      },
      {
        type: 'document',
        permission: 'document.view',
        search: async (actor, term, limit) =>
          tag('document')(await getDocumentService().searchDocuments(actor, term, limit)),
      },
      {
        // One's own tasks need no permission; the task service widens to scope only with task.view.
        type: 'task',
        search: async (actor, term, limit) =>
          tag('task')(await getTaskService().searchTasks(actor, term, limit)),
      },
    ];
    searchService ??= new SearchService({ providers, logger });
    return searchService;
  }

  /**
   * Import and export (CORE-IMPORT-001 … 003). Each importer and exporter belongs to its module; the
   * feature flags come from settings, and exports are written to the same private file store as
   * documents, reached only by a short-lived signed link.
   */
  function getImportService(): ImportService {
    const connection = requireConnection();
    importService ??= new ImportService({
      connection,
      audit: getAuditService(),
      store: fileStore,
      importers: [
        referenceItemImporter(getSettingsService),
        leadImporter(getCrmService, (code) => getOrganizationService().findBranchByCode(code)),
      ],
      exporters: [
        {
          kind: 'leads',
          permission: 'crm.lead.export',
          rows: (actor, limit) => getCrmService().exportLeads(actor, limit),
        },
        {
          kind: 'units',
          permission: 'inventory.unit.export',
          rows: (actor, limit) => getInventoryService().exportUnits(actor, limit),
        },
      ],
      readXlsx: readFirstSheet,
      importsEnabled: () => getSettingsService().isEnabled('feature.imports'),
      exportsEnabled: () => getSettingsService().isEnabled('feature.exports'),
    });
    return importService;
  }

  /**
   * The integration foundation (INTEGRATION-001 … 005, ADR-0010). **No adapter is registered**: every
   * provider reads `noAdapter`, its webhook endpoint answers 404, and an outbound operation is held.
   * Credentials go through the same encryptor as MFA secrets, so they cannot be stored in staging or
   * production until the KMS adapter exists (`SEC-033`).
   */
  function getIntegrationService(): IntegrationService {
    const connection = requireConnection();
    integrationService ??= new IntegrationService({
      connection,
      audit: getAuditService(),
      encryptor: buildEncryptor(),
      adapters: [],
      logger,
    });
    return integrationService;
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
   * The approval engine as a module sees it (ADR-0024): `submit` resolves to nothing when no policy
   * applies — the normal case until `SD-02` supplies one — and `state` reads the outcome. One port,
   * shared by every module that asks for approval, so the "no policy is not an error" rule lives once.
   */
  const approvalPort: InventoryApprovalPort = {
    submit: async (actor, input, context) => {
      try {
        const result = await getApprovalService().submit(actor, input, context);
        return { requestId: result.request.requestId, state: result.request.state };
      } catch (error) {
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
    applies: (actor, input) => getApprovalService().hasApplicablePolicy(actor, input),
  };

  /** Unit price versions (INV-PRICE-001, 003): changes wait for approval where a policy applies. */
  function getPriceService(): PriceService {
    const connection = requireConnection();
    priceService ??= new PriceService({
      connection,
      audit: getAuditService(),
      logger,
      inventory: getInventoryService(),
      approvals: approvalPort,
      today: () => businessDateInZone(nowInstant(), config.ORG_TIMEZONE),
    });
    return priceService;
  }

  /** Timed customer holds (INV-HOLD-001, 002). Their length is `BD-29`; none is assumed. */
  function getHoldService(): HoldService {
    const connection = requireConnection();
    holdService ??= new HoldService({
      connection,
      audit: getAuditService(),
      logger,
      inventory: getInventoryService(),
      approvals: approvalPort,
      holdHours: () => getSettingsService().valueOf<number>('sales.unitHoldHours'),
    });
    return holdService;
  }

  /** Payment-plan templates (INV-PLAN-001). */
  function getPlanTemplateService(): PlanTemplateService {
    const connection = requireConnection();
    planTemplateService ??= new PlanTemplateService({
      connection,
      audit: getAuditService(),
      inventory: getInventoryService(),
    });
    return planTemplateService;
  }

  /**
   * A decided approval is acted on at once by the module that asked for it (ADR-0024 §2: the engine
   * records, the owning module acts). The maintenance sweep settles the same requests again, so an
   * outcome lost here — a crash between the decision and this call — is applied on the next run.
   */
  async function settleApprovalOutcome(requestId: string): Promise<void> {
    const context = { correlationId: `approval-outcome-${requestId}`, route: 'approval/outcome' };
    for (const settle of [
      () => getPriceService().syncApproval(MAINTENANCE_ACTOR, requestId, context),
      () => getHoldService().syncApproval(MAINTENANCE_ACTOR, requestId, context),
      () => getSalesService().syncApproval(MAINTENANCE_ACTOR, requestId, context),
    ]) {
      try {
        await settle();
      } catch (error) {
        logger.warn(
          { err: error, code: 'APPROVAL_OUTCOME_NOT_SETTLED', requestId },
          'An approval outcome could not be applied now; the maintenance sweep will retry it.',
        );
      }
    }
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
      describeAccount,
      // Loss reasons are the deployment's own list (PLAT-025); an inactive code is refused.
      isActiveReason: async (list, code) =>
        (await getSettingsService().activeCodes(list)).includes(code),
    });
    return crmService;
  }

  /**
   * Opportunities (CRM-OPP). Win probabilities are the deployment's configuration (BD-27); with none
   * configured the service shows no probability and no weighted pipeline.
   */
  function getOpportunityService(): OpportunityService {
    const connection = requireConnection();
    opportunityService ??= new OpportunityService({
      connection,
      audit: getAuditService(),
      crm: getCrmService(),
      probabilities: () =>
        getSettingsService().valueOf<Record<string, string>>('sales.opportunityStageProbabilities'),
      isActiveReason: async (list, code) =>
        (await getSettingsService().activeCodes(list)).includes(code),
    });
    return opportunityService;
  }

  /**
   * What a module needs to know before handing work to a colleague (CRM-ASSIGN-001): whether the
   * account is active (SEC), what it may do (SEC, effective permissions after denials), and where it
   * sits (CORE-ORG). Each fact comes from its owner; none is stored twice.
   */
  async function describeAccount(accountId: string) {
    let active: boolean;
    try {
      active = (await getIdentityService().getAccount(accountId)).state === 'active';
    } catch {
      // An unknown account, or no identity service configured: nobody to hand work to.
      return undefined;
    }
    const grants = await getSecurityService().resolveActor(accountId);
    const placement = await getOrganizationService().getPlacementByAccount(accountId);
    return {
      active,
      permissions: grants ? effectivePermissions(grants) : [],
      ...(placement
        ? {
            placement: {
              legalEntityId: placement.legalEntityId,
              branchId: placement.branchId,
              departmentId: placement.departmentId,
              ...(placement.teamId ? { teamId: placement.teamId } : {}),
            },
          }
        : {}),
    };
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
            await settleApprovalOutcome(event.requestId);
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
                ...(unit.heldByHoldId ? { heldByHoldId: unit.heldByHoldId } : {}),
                ...(unit.heldByReservationId
                  ? { heldByReservationId: unit.heldByReservationId }
                  : {}),
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
      approvals: approvalPort,
      holds: {
        find: async (holdId, session) => {
          const hold = await getHoldService().findUnscoped(holdId, session);
          return hold
            ? {
                holdId: hold.holdId,
                unitId: hold.unitId,
                state: hold.state,
                holderAccountId: hold.holderAccountId,
              }
            : undefined;
        },
        convert: (actor, holdId, reservationId, expected, context, session) =>
          getHoldService().convert(actor, holdId, reservationId, expected, context, session),
      },
      opportunities: {
        find: async (actor, opportunityId) => {
          const opportunity = await getOpportunityService().get(actor, opportunityId);
          return {
            opportunityId: opportunity.opportunityId,
            customerId: opportunity.customerId,
            stage: opportunity.stage,
          };
        },
        advance: async (actor, opportunityId, to, links, reason, context, session) => {
          await getOpportunityService().advanceInternal(
            actor,
            opportunityId,
            to,
            links,
            reason,
            context,
            session,
          );
        },
      },
      // The commercial rules are the deployment's configuration; none is assumed (BD-01 … BD-03).
      policies: {
        validityDays: () => getSettingsService().valueOf<number>('sales.reservationValidityDays'),
        minimumDeposit: () =>
          getSettingsService().valueOf<DepositRule>('sales.reservationMinimumDeposit'),
        maximumDiscountPercent: () =>
          getSettingsService().valueOf<string>('sales.maximumDiscountPercent'),
      },
      // Official numbers through CORE-DOC-001 once a format is active (BD-19); until then, none.
      numbers: {
        issue: async (input, session) => {
          const project = await getInventoryService().findProjectUnscoped(input.projectId);
          try {
            const issued = await getNumberingService().issue(
              { accountId: 'system:sales' },
              {
                type: input.type,
                issueDate: input.issueDate,
                ...(project ? { projectCode: project.code } : {}),
                source: input.source,
                idempotencyKey: `${input.type}-${input.source.id}`,
              },
              session,
            );
            return issued.number;
          } catch (error) {
            const issue = (error as { issues?: { code: string }[] }).issues?.[0]?.code;
            if (issue === 'NO_ACTIVE_SEQUENCE') return undefined;
            throw error;
          }
        },
      },
      // Contract drafting (SALE-CONTRACT-001 … 004): snapshots, parties, signed copies, the trail.
      unitSnapshots: {
        snapshot: async (unitId, session) => {
          const unit = await getInventoryService().findUnitForUpdate(unitId, session);
          if (!unit) return undefined;
          const project = await getInventoryService().findProjectUnscoped(unit.projectId);
          return {
            unitId: unit.unitId,
            code: unit.code,
            projectId: unit.projectId,
            ...(project ? { projectCode: project.code, projectName: project.name } : {}),
            buildingId: unit.buildingId,
            floor: unit.floor,
            propertyType: unit.propertyType,
            usageType: unit.usageType,
            finishingStatus: unit.finishingStatus,
            area: unit.area,
            ...(unit.gardenArea ? { gardenArea: unit.gardenArea } : {}),
            ...(unit.roofArea ? { roofArea: unit.roofArea } : {}),
            ...(unit.bedrooms !== undefined ? { bedrooms: unit.bedrooms } : {}),
            ...(unit.bathrooms !== undefined ? { bathrooms: unit.bathrooms } : {}),
          };
        },
      },
      customers: {
        snapshot: async (actor, customerId) => {
          // Scoped and field-restricted first; a drafter outside the customer's scope still records
          // the name and phone, never the identity.
          const customer = await getCrmService()
            .customerForSnapshot(actor, customerId)
            .catch(() => getCrmService().findCustomerUnscoped(customerId));
          if (!customer) return undefined;
          return {
            customerId: customer.customerId,
            kind: customer.kind,
            name: customer.name,
            ...(customer.alternateName ? { alternateName: customer.alternateName } : {}),
            primaryPhone: customer.primaryPhone,
            ...(customer.email ? { email: customer.email } : {}),
            ...(customer.address ? { address: customer.address } : {}),
            ...(customer.city ? { city: customer.city } : {}),
            ...('identity' in customer && customer.identity
              ? {
                  identity: {
                    type: customer.identity.type,
                    number: customer.identity.number,
                    ...(customer.identity.issuingCountry
                      ? { issuingCountry: customer.identity.issuingCountry }
                      : {}),
                  },
                }
              : {}),
          };
        },
        inScope: async (actor, customerId) => {
          try {
            const customer = await getCrmService().getCustomer(actor, customerId);
            return { name: customer.name };
          } catch {
            return undefined;
          }
        },
      },
      signedCopies: {
        ownerOf: async (actor, documentId) => {
          try {
            return (await getDocumentService().getDocument(actor, documentId)).owner;
          } catch {
            return undefined;
          }
        },
      },
      history: {
        targetHistory: async (target, limit) =>
          ContractHistorySchema.shape.items.parse(
            await getAuditService().targetHistory(target, limit),
          ),
      },
      today: () => businessDateInZone(nowInstant(), config.ORG_TIMEZONE),
    });
    return salesService;
  }

  /**
   * Issued documents (CORE-DOC-003, CORE-DOC-005).
   *
   * Each source is read through its owning module's **scoped, field-restricted** getter for the actor
   * generating it: an out-of-scope record is not found, and a restricted field the actor cannot see is
   * simply absent from the data, so it cannot reach the PDF. A display name that is not a restricted
   * field (the customer on a reservation or receipt) is read unscoped, exactly as the record's own
   * screen names it.
   */
  function getIssuanceService(): IssuanceService {
    const connection = requireConnection();
    const customerName = async (customerId: string) =>
      (await getCrmService().findCustomerUnscoped(customerId))?.name;
    const load = async (
      actor: Parameters<IssuanceService['issue']>[0],
      type: Parameters<IssuanceService['issue']>[1]['type'],
      sourceId: string,
    ): Promise<LoadedSource> => {
      switch (type) {
        case 'quotation': {
          const [q] = (await getQuotationService().revisions(actor, sourceId)).items;
          if (!q) throw new AppError('NOT_FOUND', 404);
          const project = await getInventoryService().findProjectUnscoped(q.projectId);
          let recipientName = q.customerId ? await customerName(q.customerId) : undefined;
          if (!recipientName && q.leadId) {
            recipientName = await getCrmService()
              .getLead(actor, q.leadId)
              .then((lead) => lead.name)
              .catch(() => undefined);
          }
          return {
            data: {
              type,
              quotation: q,
              ...(recipientName ? { recipientName } : {}),
              ...(project ? { projectName: project.name } : {}),
            },
            owner: { type: 'quotation', id: q.quotationId },
            businessReference: q.quotationNumber,
            placement: q,
            warnings: q.state === 'active' ? [] : [q.state],
            restricted: [],
            validUntil: q.validUntil,
          };
        }
        case 'reservation': {
          const r = await getSalesService().getReservation(actor, sourceId);
          const unit = await getInventoryService().findUnitForUpdate(r.unitId);
          const project = await getInventoryService().findProjectUnscoped(r.projectId);
          const name = await customerName(r.customerId);
          const ended = r.state === 'cancelled' || r.state === 'expired' || r.state === 'rejected';
          return {
            data: {
              type,
              reservation: r,
              ...(name ? { customerName: name } : {}),
              ...(unit ? { unitCode: unit.code } : {}),
              ...(project ? { projectName: project.name } : {}),
            },
            owner: { type: 'reservation', id: r.reservationId },
            businessReference: r.reservationNumber,
            placement: { ...r, ownerAccountId: r.salesOwnerAccountId },
            warnings: ended
              ? ['cancelled']
              : r.state === 'confirmed' || r.state === 'converted'
                ? []
                : ['notFinal'],
            restricted: [],
            registry: { kind: 'reservationForm', projectId: r.projectId },
          };
        }
        case 'contractSummary':
        case 'installmentSchedule': {
          const contract = await getSalesService().getContract(actor, sourceId);
          const installments = await getSalesService().listContractInstallments(actor, sourceId);
          const warnings: LoadedSource['warnings'] = [];
          if (contract.state === 'draft') warnings.push('draft');
          if (contract.state === 'pendingApproval') warnings.push('notFinal');
          if (contract.state === 'cancelled') warnings.push('cancelled');
          if (contract.warnings.includes('identityMissing')) warnings.push('identityMissing');
          // The identity is present only if this actor may see it — then the file must say so.
          const printsIdentity =
            type === 'contractSummary' && Boolean(contract.customerSnapshot?.identity);
          // A contract drafted before snapshots existed names its buyer and unit from the current
          // records — non-restricted display names, the same ones its own screen shows.
          let current: { customerName?: string; unitCode?: string; projectName?: LocalizedLabel } =
            {};
          if (!contract.customerSnapshot || !contract.unitSnapshot) {
            const unit = await getInventoryService().findUnitForUpdate(contract.unitId);
            const project = await getInventoryService().findProjectUnscoped(contract.projectId);
            const name = await customerName(contract.customerId);
            current = {
              ...(name ? { customerName: name } : {}),
              ...(unit ? { unitCode: unit.code } : {}),
              ...(project ? { projectName: project.name } : {}),
            };
          }
          return {
            data: {
              type,
              contract,
              installments,
              ...(Object.keys(current).length > 0 ? { current } : {}),
            },
            owner: { type: 'contract', id: contract.contractId },
            businessReference: contract.contractNumber,
            placement: { ...contract, ownerAccountId: contract.salesOwnerAccountId },
            warnings,
            restricted: printsIdentity ? ['crm.customer.viewIdentity'] : [],
            registry: {
              kind: type === 'contractSummary' ? 'contract' : 'installmentSchedule',
              projectId: contract.projectId,
            },
          };
        }
        case 'receipt': {
          const receipt = await getCollectionService().getReceipt(actor, sourceId);
          const contract = await getSalesService().findContract(receipt.contractId);
          const name = await customerName(receipt.customerId);
          return {
            data: {
              type,
              receipt,
              ...(name ? { customerName: name } : {}),
              ...(contract ? { contractNumber: contract.contractNumber } : {}),
            },
            owner: { type: 'receipt', id: receipt.receiptId },
            businessReference: receipt.receiptNumber,
            placement: { ...receipt, ownerAccountId: receipt.receivedByAccountId },
            warnings: receipt.state === 'reversed' ? ['reversed'] : [],
            restricted: [],
            registry: { kind: 'receipt', projectId: receipt.projectId },
          };
        }
        case 'customerStatement': {
          const customer = await getCrmService().getCustomer(actor, sourceId);
          const summary = await getSalesService().customerSummary(actor, sourceId);
          const contracts = await getSalesService().listContracts(actor, {
            customerId: sourceId,
            limit: 100,
          });
          const receipts = await getCollectionService().listReceipts(actor, {
            customerId: sourceId,
            limit: 100,
          });
          const installments = await getSalesService().listInstallments(actor, {
            customerId: sourceId,
            limit: 200,
          });
          const open = new Set(['upcoming', 'due', 'partiallyPaid', 'overdue']);
          return {
            data: {
              type,
              customer,
              summary,
              contracts: contracts.items.filter(
                (contract) => contract.state !== 'draft' && contract.state !== 'pendingApproval',
              ),
              receipts: receipts.items,
              openInstallments: installments.items.filter((row) => open.has(row.state)),
              statementNumber: '',
            },
            owner: { type: 'customer', id: customer.customerId },
            businessReference: '',
            placement: customer,
            warnings: [],
            restricted: [],
            registry: { kind: 'customerStatement' },
          };
        }
      }
    };
    issuanceService ??= new IssuanceService({
      connection,
      logger,
      audit: getAuditService(),
      documents: getDocumentService,
      templates: getTemplateService,
      sources: { load },
      company: async () => {
        const profile = await getCompanyService().getProfile();
        if (!profile) return undefined;
        const logo = await getCompanyService()
          .activeAsset('logo')
          .catch(() => undefined);
        return {
          version: profile.version,
          legalName: profile.legalName,
          tradeName: profile.tradeName,
          shortName: profile.shortName,
          ...(profile.commercialRegistration
            ? { commercialRegistration: profile.commercialRegistration }
            : {}),
          ...(profile.taxRegistration ? { taxRegistration: profile.taxRegistration } : {}),
          ...(profile.address ? { address: profile.address } : {}),
          ...(profile.phone ? { phone: profile.phone } : {}),
          ...(profile.email ? { email: profile.email } : {}),
          ...(profile.documentFooter ? { documentFooter: profile.documentFooter } : {}),
          ...(logo ? { logo: logo.data } : {}),
          ...(profile.primaryColor ? { primaryColor: profile.primaryColor } : {}),
          timeZone: profile.timeZone,
        };
      },
      statementNumber: () =>
        withTransaction(connection, (session) => getSalesService().allocateNumber('STM', session)),
      publicBaseUrl: config.PUBLIC_APP_URL ?? config.CORS_ALLOWED_ORIGINS[0] ?? '',
      today: () => businessDateInZone(nowInstant(), config.ORG_TIMEZONE),
    });
    return issuanceService;
  }

  /**
   * Quotations (SALE-QUOTE-001). The unit is read through the actor's own scope and price visibility,
   * and nothing here can change a unit: a quotation never reserves inventory.
   */
  function getQuotationService(): QuotationService {
    const connection = requireConnection();
    quotationService ??= new QuotationService({
      connection,
      audit: getAuditService(),
      units: {
        priced: async (actor, unitId) => {
          const unit = await getInventoryService().getUnit(actor, unitId);
          return {
            unitId: unit.unitId,
            code: unit.code,
            projectId: unit.projectId,
            legalEntityId: unit.legalEntityId,
            branchId: unit.branchId,
            ...(unit.currentPrice ? { currentPrice: unit.currentPrice } : {}),
          };
        },
      },
      recipients: {
        customerInScope: async (actor, customerId) => {
          try {
            await getCrmService().getCustomer(actor, customerId);
            return true;
          } catch {
            return false;
          }
        },
        leadInScope: async (actor, leadId) => {
          try {
            await getCrmService().getLead(actor, leadId);
            return true;
          } catch {
            return false;
          }
        },
        opportunity: async (actor, opportunityId) => {
          try {
            const opportunity = await getOpportunityService().get(actor, opportunityId);
            return { customerId: opportunity.customerId };
          } catch {
            return undefined;
          }
        },
      },
      issueNumber: async (input, session) => {
        const project = await getInventoryService().findProjectUnscoped(input.projectId);
        try {
          const issued = await getNumberingService().issue(
            { accountId: 'system:sales' },
            {
              type: 'quotation',
              issueDate: input.issueDate,
              ...(project ? { projectCode: project.code } : {}),
              source: input.source,
              idempotencyKey: `quotation-${input.source.id}`,
            },
            session,
          );
          return issued.number;
        } catch (error) {
          const issue = (error as { issues?: { code: string }[] }).issues?.[0]?.code;
          if (issue === 'NO_ACTIVE_SEQUENCE') return undefined;
          throw error;
        }
      },
      legacyNumber: (prefix, session) => getSalesService().allocateNumber(prefix, session),
      today: () => businessDateInZone(nowInstant(), config.ORG_TIMEZONE),
    });
    return quotationService;
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
    prices: getPriceService,
    holds: getHoldService,
    planTemplates: getPlanTemplateService,
    crm: getCrmService,
    opportunities: getOpportunityService,
    sales: getSalesService,
    quotations: getQuotationService,
    issuance: getIssuanceService,
    collections: getCollectionService,
    marketing: getMarketingService,
    company: getCompanyService,
    settings: getSettingsService,
    numbering: getNumberingService,
    documents: getDocumentService,
    templates: getTemplateService,
    notifications: getNotificationService,
    tasks: getTaskService,
    search: getSearchService,
    imports: getImportService,
    integrations: getIntegrationService,
    fileStore,
  };
}
