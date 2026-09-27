import {
  CreateReferenceItemSchema,
  REFERENCE_LISTS,
  ReferenceItemListSchema,
  ReferenceItemSchema,
  ReferenceLifecycleSchema,
  SETTING_KEYS,
  SettingListSchema,
  SettingRevisionListSchema,
  SettingSchema,
  TaxRateSchema,
  UpdateReferenceItemSchema,
  UpdateSettingSchema,
} from '@alola/contracts';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

/** Schemas settings and reference data contribute (PLAT-024 … PLAT-026). */
export const settingsComponents = {
  Setting: SettingSchema,
  SettingList: SettingListSchema,
  SettingRevisionList: SettingRevisionListSchema,
  UpdateSettingRequest: UpdateSettingSchema,
  ReferenceItem: ReferenceItemSchema,
  ReferenceItemList: ReferenceItemListSchema,
  CreateReferenceItemRequest: CreateReferenceItemSchema,
  UpdateReferenceItemRequest: UpdateReferenceItemSchema,
  ReferenceLifecycleRequest: ReferenceLifecycleSchema,
  TaxRateRequest: TaxRateSchema,
} as const;

const keyParameter = {
  name: 'key',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: [...SETTING_KEYS] },
  description: 'A catalogued setting key; nothing else can be stored',
};
const listParameter = {
  name: 'list',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: [...REFERENCE_LISTS] },
  description: 'A reference list',
};

const MANAGE =
  'Requires the administrative referenceData.manage permission (second factor mandatory).';

export function settingsPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/settings': {
      get: {
        operationId: 'listSettings',
        summary: 'Every catalogued setting and feature flag with the value in force',
        description:
          'Requires settings.view. A value the stakeholders have not decided is null — not configured — ' +
          'and names the open decision it waits for; consumers must not treat null as a number.',
        responses: { '200': h.json('SettingList', 'The settings'), ...h.authorizedErrors },
      },
    },
    '/api/v1/settings/{key}': {
      get: {
        operationId: 'getSetting',
        summary: 'One setting',
        description: 'Requires settings.view.',
        parameters: [keyParameter],
        responses: { '200': h.json('Setting', 'The setting'), ...h.authorizedErrors },
      },
      put: {
        operationId: 'updateSetting',
        summary: 'Change a setting or a feature flag',
        description:
          'Requires the administrative settings.manage permission. The value is validated against ' +
          "the setting's own schema; null returns it to its default. Guarded by expectedVersion (0 " +
          'for a setting never changed); a stale version is CONFLICT. A feature gated by an ADR is ' +
          'refused with FEATURE_LOCKED. The change, an append-only revision and the audit record ' +
          'commit together, with the reason.',
        parameters: [keyParameter],
        requestBody: requestBody(h.ref('UpdateSettingRequest')),
        responses: { '200': h.json('Setting', 'The setting'), ...h.conflictErrors },
      },
    },
    '/api/v1/settings/{key}/history': {
      get: {
        operationId: 'getSettingHistory',
        summary: 'Every value a setting has had, newest first',
        description: 'Requires settings.view. Append-only.',
        parameters: [keyParameter],
        responses: { '200': h.json('SettingRevisionList', 'The history'), ...h.authorizedErrors },
      },
    },
    '/api/v1/reference-data/{list}': {
      get: {
        operationId: 'listReferenceItems',
        summary: 'The items of a reference list, ordered',
        description:
          'Requires only authentication: every form needs its lists. Returns active items; ' +
          'includeInactive=true additionally needs referenceData.manage. A list bound to a product ' +
          "enumeration always contains every product code, with the deployment's label where it set one.",
        parameters: [
          listParameter,
          queryParameter('includeInactive', { type: 'string', enum: ['true', 'false'] }),
        ],
        responses: { '200': h.json('ReferenceItemList', 'The items'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createReferenceItem',
        summary: 'Add an item to an open list',
        description: `${MANAGE} Refused for a list bound to the product (LIST_BOUND_TO_PRODUCT). The code is permanent.`,
        parameters: [listParameter],
        requestBody: requestBody(h.ref('CreateReferenceItemRequest')),
        responses: { '201': h.json('ReferenceItem', 'The item'), ...h.conflictErrors },
      },
    },
    '/api/v1/reference-data/{list}/{code}': {
      patch: {
        operationId: 'updateReferenceItem',
        summary: 'Relabel, describe or reorder an item',
        description:
          `${MANAGE} The code never changes, so every record carrying it keeps its meaning. Guarded by ` +
          'expectedVersion (0 for a bound item never overridden).',
        parameters: [listParameter, pathParameter('code', 'Stable item code')],
        requestBody: requestBody(h.ref('UpdateReferenceItemRequest')),
        responses: { '200': h.json('ReferenceItem', 'The item'), ...h.conflictErrors },
      },
    },
    ...Object.fromEntries(
      (['deactivate', 'reactivate'] as const).map((change): [string, Record<string, unknown>] => [
        `/api/v1/reference-data/{list}/{code}/${change}`,
        {
          post: {
            operationId: `${change}ReferenceItem`,
            summary:
              change === 'deactivate' ? 'Withdraw an item from new use' : 'Offer an item again',
            description:
              `${MANAGE} Nothing is deleted; records already carrying the code keep it. The ` +
              'pipeline-stage list is locked (ITEM_LOCKED): its state machine needs every stage.',
            parameters: [listParameter, pathParameter('code', 'Stable item code')],
            requestBody: requestBody(h.ref('ReferenceLifecycleRequest')),
            responses: { '200': h.json('ReferenceItem', 'The item'), ...h.conflictErrors },
          },
        },
      ]),
    ),
    '/api/v1/reference-data/taxCodes/{code}/rates': {
      post: {
        operationId: 'addTaxRate',
        summary: 'Add a tax rate in force from a date',
        description:
          `${MANAGE} Rates are never edited and never backdated before the latest (RATE_NOT_FORWARD), ` +
          'so a rate that governed a document stays what it was. No rate is seeded: the values are SD-08.',
        parameters: [pathParameter('code', 'Tax code')],
        requestBody: requestBody(h.ref('TaxRateRequest')),
        responses: {
          '200': h.json('ReferenceItem', 'The tax code with its rates'),
          ...h.conflictErrors,
        },
      },
    },
  };
}
