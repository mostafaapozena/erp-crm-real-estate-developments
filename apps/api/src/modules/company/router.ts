import {
  BRAND_ASSET_MAX_BYTES,
  BrandAssetSlotSchema,
  CompanyProfileInputSchema,
  UpdateCompanyProfileSchema,
} from '@alola/contracts';
import express, { Router } from 'express';
import { z } from 'zod';
import { requirePermission, type GuardOptions } from '../../http/actor';
import { requestContextOf, requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import { invalid, notFound } from '../../platform/audit-port';
import type { CompanyService } from './service';

/**
 * Company profile HTTP surface (PLAT-022, PLAT-023).
 *
 * Two routers, because they have opposite audiences:
 *
 * - `/api/v1/company` — administration. Reading needs `company.profile.view`; every change needs the
 *   administrative `company.profile.manage`, which carries a mandatory second factor (SEC-017).
 * - `/api/v1/branding` — **public**, read-only, and deliberately small: what a browser needs to draw
 *   the sign-in screen before anyone has signed in. It exposes no registration number, no contact
 *   detail and no history.
 */
export interface CompanyRouterOptions {
  getService: () => CompanyService;
  guard?: GuardOptions;
}

const SlotParamsSchema = z.strictObject({ slot: BrandAssetSlotSchema });
const RevisionQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const AssetQuerySchema = z.strictObject({
  /** Cache-busting content hash prefix. Ignored beyond its shape. */
  v: z
    .string()
    .regex(/^[0-9a-f]{1,64}$/)
    .optional(),
});

export function companyRouter(options: CompanyRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/company';

  router.get(
    '/profile',
    requirePermission('company.profile.view', options.guard),
    async (_req, res) => {
      res.json(await options.getService().requireProfile());
    },
  );

  router.get(
    '/profile/revisions',
    requirePermission('company.profile.view', options.guard),
    validate({ query: RevisionQuerySchema }),
    async (_req, res) => {
      const { limit } = validated<typeof RevisionQuerySchema._output>(res, 'query');
      res.json({ items: await options.getService().listRevisions(limit) });
    },
  );

  router.post(
    '/profile',
    requirePermission('company.profile.manage', options.guard),
    validate({ body: CompanyProfileInputSchema }),
    async (req, res) => {
      const body = validated<typeof CompanyProfileInputSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createProfile(requireActor(res), body, requestContextOf(req, res, `${base}/profile`));
      res.status(201).json(created);
    },
  );

  router.put(
    '/profile',
    requirePermission('company.profile.manage', options.guard),
    validate({ body: UpdateCompanyProfileSchema }),
    async (req, res) => {
      const body = validated<typeof UpdateCompanyProfileSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updateProfile(requireActor(res), body, requestContextOf(req, res, `${base}/profile`)),
      );
    },
  );

  /**
   * The image itself is the request body, sent with its content type. The body parser here accepts
   * any type so that a wrong one reaches validation and is refused with a code, rather than arriving
   * empty; the bytes are then checked against their magic numbers, never against the header.
   */
  router.put(
    '/profile/assets/:slot',
    requirePermission('company.profile.manage', options.guard),
    express.raw({ type: () => true, limit: BRAND_ASSET_MAX_BYTES }),
    validate({ params: SlotParamsSchema }),
    async (req, res) => {
      const { slot } = validated<typeof SlotParamsSchema._output>(res, 'params');
      const bytes: unknown = req.body;
      if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) throw invalid('EMPTY_FILE', ['file']);
      res.json(
        await options
          .getService()
          .uploadAsset(
            requireActor(res),
            slot,
            { bytes, declaredType: req.get('content-type') ?? '' },
            requestContextOf(req, res, `${base}/profile/assets/:slot`),
          ),
      );
    },
  );

  return router;
}

export function brandingRouter(options: Pick<CompanyRouterOptions, 'getService'>): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    // Short-lived: a changed logo or colour shows within a minute without a rebuild or a restart.
    res.setHeader('Cache-Control', 'no-cache');
    res.json(await options.getService().publicBranding());
  });

  router.get(
    '/assets/:slot',
    validate({ params: SlotParamsSchema, query: AssetQuerySchema }),
    async (_req, res) => {
      const { slot } = validated<typeof SlotParamsSchema._output>(res, 'params');
      const { v } = validated<typeof AssetQuerySchema._output>(res, 'query');
      const asset = await options.getService().activeAsset(slot);
      if (!asset) throw notFound();
      // A request naming the current hash may be cached for a long time; anything else revalidates.
      const current = v !== undefined && asset.sha256.startsWith(v) && v.length >= 16;
      res.setHeader('Content-Type', asset.contentType);
      res.setHeader('Content-Length', String(asset.data.byteLength));
      res.setHeader('ETag', `"${asset.sha256}"`);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader(
        'Cache-Control',
        current ? 'public, max-age=31536000, immutable' : 'public, no-cache',
      );
      res.end(asset.data);
    },
  );

  return router;
}
