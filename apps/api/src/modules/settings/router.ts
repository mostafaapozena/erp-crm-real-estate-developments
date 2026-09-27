import {
  BOUND_REFERENCE_LISTS,
  CreateReferenceItemSchema,
  LOCKED_REFERENCE_LISTS,
  REFERENCE_LISTS,
  ReferenceCodeSchema,
  ReferenceLifecycleSchema,
  ReferenceListQuerySchema,
  ReferenceListSchema,
  SettingKeySchema,
  TaxRateSchema,
  UpdateReferenceItemSchema,
  UpdateSettingSchema,
} from '@alola/contracts';
import { can } from '@alola/security';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { requireAuthenticated, requirePermission, type GuardOptions } from '../../http/actor';
import { requestContextOf, requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import type { SettingsService } from './service';

/**
 * Settings and reference data HTTP surface (PLAT-024 … PLAT-026).
 *
 * Settings are read with `settings.view` and changed with the administrative `settings.manage`.
 * Reference lists are readable by anyone signed in — every form needs its dropdowns — but only their
 * **active** items; the inactive ones, and every change, need the administrative
 * `referenceData.manage`.
 */
export interface SettingsRouterOptions {
  getService: () => SettingsService;
  guard?: GuardOptions;
}

const KeyParamsSchema = z.strictObject({ key: SettingKeySchema });
const ListParamsSchema = z.strictObject({ list: ReferenceListSchema });
const ItemParamsSchema = z.strictObject({ list: ReferenceListSchema, code: ReferenceCodeSchema });
const TaxParamsSchema = z.strictObject({ code: ReferenceCodeSchema });

export function settingsRouter(options: SettingsRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/settings';

  router.get('/', requirePermission('settings.view', options.guard), async (_req, res) => {
    res.json({ items: await options.getService().listSettings() });
  });

  router.get(
    '/:key',
    requirePermission('settings.view', options.guard),
    validate({ params: KeyParamsSchema }),
    async (_req, res) => {
      const { key } = validated<typeof KeyParamsSchema._output>(res, 'params');
      res.json(await options.getService().getSetting(key));
    },
  );

  router.get(
    '/:key/history',
    requirePermission('settings.view', options.guard),
    validate({ params: KeyParamsSchema }),
    async (_req, res) => {
      const { key } = validated<typeof KeyParamsSchema._output>(res, 'params');
      res.json({ items: await options.getService().settingHistory(key) });
    },
  );

  router.put(
    '/:key',
    requirePermission('settings.manage', options.guard),
    validate({ params: KeyParamsSchema, body: UpdateSettingSchema }),
    async (req, res) => {
      const { key } = validated<typeof KeyParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdateSettingSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updateSetting(requireActor(res), key, body, requestContextOf(req, res, `${base}/:key`)),
      );
    },
  );

  return router;
}

export function referenceDataRouter(options: SettingsRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/reference-data';

  router.get('/', requireAuthenticated(options.guard), (_req, res) => {
    res.json({
      items: REFERENCE_LISTS.map((list) => ({
        list,
        bound: BOUND_REFERENCE_LISTS[list] !== undefined,
        locked: LOCKED_REFERENCE_LISTS.includes(list),
      })),
    });
  });

  router.get(
    '/:list',
    requireAuthenticated(options.guard),
    validate({ params: ListParamsSchema, query: ReferenceListQuerySchema }),
    async (_req, res) => {
      const { list } = validated<typeof ListParamsSchema._output>(res, 'params');
      const { includeInactive } = validated<typeof ReferenceListQuerySchema._output>(res, 'query');
      // Retired items are administration, not a dropdown: they need the manage permission.
      if (includeInactive === true && !can(requireActor(res), 'referenceData.manage')) {
        throw new AppError('FORBIDDEN', 403);
      }
      res.json({
        list,
        bound: BOUND_REFERENCE_LISTS[list] !== undefined,
        items: await options
          .getService()
          .listItems(list, { includeInactive: includeInactive === true }),
      });
    },
  );

  router.post(
    '/taxCodes/:code/rates',
    requirePermission('referenceData.manage', options.guard),
    validate({ params: TaxParamsSchema, body: TaxRateSchema }),
    async (req, res) => {
      const { code } = validated<typeof TaxParamsSchema._output>(res, 'params');
      const body = validated<typeof TaxRateSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .addTaxRate(
            requireActor(res),
            code,
            body,
            requestContextOf(req, res, `${base}/taxCodes/:code/rates`),
          ),
      );
    },
  );

  router.post(
    '/:list',
    requirePermission('referenceData.manage', options.guard),
    validate({ params: ListParamsSchema, body: CreateReferenceItemSchema }),
    async (req, res) => {
      const { list } = validated<typeof ListParamsSchema._output>(res, 'params');
      const body = validated<typeof CreateReferenceItemSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createItem(requireActor(res), list, body, requestContextOf(req, res, `${base}/:list`));
      res.status(201).json(created);
    },
  );

  router.patch(
    '/:list/:code',
    requirePermission('referenceData.manage', options.guard),
    validate({ params: ItemParamsSchema, body: UpdateReferenceItemSchema }),
    async (req, res) => {
      const { list, code } = validated<typeof ItemParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdateReferenceItemSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updateItem(
            requireActor(res),
            list,
            code,
            body,
            requestContextOf(req, res, `${base}/:list/:code`),
          ),
      );
    },
  );

  for (const change of ['deactivate', 'reactivate'] as const) {
    router.post(
      `/:list/:code/${change}`,
      requirePermission('referenceData.manage', options.guard),
      validate({ params: ItemParamsSchema, body: ReferenceLifecycleSchema }),
      async (req, res) => {
        const { list, code } = validated<typeof ItemParamsSchema._output>(res, 'params');
        const { reason } = validated<typeof ReferenceLifecycleSchema._output>(res, 'body');
        res.json(
          await options
            .getService()
            .setItemActive(
              requireActor(res),
              list,
              code,
              change === 'reactivate',
              reason,
              requestContextOf(req, res, `${base}/:list/:code/${change}`),
            ),
        );
      },
    );
  }

  return router;
}
