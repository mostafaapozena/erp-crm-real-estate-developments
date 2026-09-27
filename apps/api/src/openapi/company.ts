import {
  BRAND_ASSET_MAX_BYTES,
  BRAND_ASSET_SLOTS,
  CompanyProfileInputSchema,
  CompanyProfileRevisionListSchema,
  CompanyProfileSchema,
  PublicBrandingSchema,
  UpdateCompanyProfileSchema,
} from '@alola/contracts';
import { queryParameter, requestBody, type OpenApiHelpers, type PathMap } from './shared';

/** Schemas the company profile contributes to `components.schemas` (PLAT-022, PLAT-023). */
export const companyComponents = {
  CompanyProfile: CompanyProfileSchema,
  CompanyProfileRequest: CompanyProfileInputSchema,
  UpdateCompanyProfileRequest: UpdateCompanyProfileSchema,
  CompanyProfileRevisionList: CompanyProfileRevisionListSchema,
  PublicBranding: PublicBrandingSchema,
} as const;

const slotParameter = {
  name: 'slot',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: [...BRAND_ASSET_SLOTS] },
  description: 'Which brand image',
};

export function companyPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/branding': {
      get: {
        operationId: 'getPublicBranding',
        summary: 'Public branding for the sign-in screen, the shell and the browser tab',
        description:
          'Public and read-only (ADR-0027). Answers the deployment identity a browser needs before ' +
          'sign-in: short and trade names, languages, the validated brand colour and image URLs. ' +
          'No registration number, contact detail or history. With no profile configured it answers ' +
          '`configured: false` and the neutral product identity — never an error.',
        responses: { '200': h.json('PublicBranding', 'The branding'), ...h.standardErrors },
      },
    },
    '/api/v1/branding/assets/{slot}': {
      get: {
        operationId: 'getBrandAsset',
        summary: 'The current brand image in one slot',
        description:
          'Public. Served with its verified content type, `nosniff`, and an ETag of its SHA-256. A ' +
          'request whose `v` matches the current hash may be cached as immutable.',
        parameters: [
          slotParameter,
          queryParameter('v', { type: 'string', pattern: '^[0-9a-f]{1,64}$' }, 'Hash prefix'),
        ],
        responses: {
          '200': {
            description: 'The image',
            content: {
              'image/png': { schema: { type: 'string', format: 'binary' } },
              'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            },
          },
          '404': h.json('ErrorResponse', 'No image in this slot (NOT_FOUND)'),
          ...h.standardErrors,
        },
      },
    },
    '/api/v1/company/profile': {
      get: {
        operationId: 'getCompanyProfile',
        summary: 'The deployment company profile',
        description: 'Requires company.profile.view. 404 until the profile is created.',
        responses: { '200': h.json('CompanyProfile', 'The profile'), ...h.notFoundErrors },
      },
      post: {
        operationId: 'createCompanyProfile',
        summary: 'Create the deployment company profile — once',
        description:
          'Requires the administrative company.profile.manage (second factor mandatory). A ' +
          'deployment is one company: a second profile is refused with CONFLICT by a unique index. ' +
          'A brand colour is refused (VALIDATION_FAILED, BRAND_COLOR_CONTRAST) unless every contrast ' +
          'pair the product uses passes WCAG AA with it. The profile holds no secret of any kind.',
        requestBody: requestBody(h.ref('CompanyProfileRequest')),
        responses: {
          '201': h.json('CompanyProfile', 'The created profile, version 1'),
          ...h.conflictErrors,
        },
      },
      put: {
        operationId: 'updateCompanyProfile',
        summary: 'Replace the editable fields of the profile',
        description:
          'Requires company.profile.manage. Guarded by `expectedVersion`: a stale version is ' +
          'CONFLICT and changes nothing. The change, a whole revision and the audit record commit ' +
          'together.',
        requestBody: requestBody(h.ref('UpdateCompanyProfileRequest')),
        responses: { '200': h.json('CompanyProfile', 'The updated profile'), ...h.conflictErrors },
      },
    },
    '/api/v1/company/profile/revisions': {
      get: {
        operationId: 'listCompanyProfileRevisions',
        summary: 'The append-only history of the profile, newest first',
        description: 'Requires company.profile.view.',
        parameters: [
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
        ],
        responses: {
          '200': h.json('CompanyProfileRevisionList', 'The revisions'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/company/profile/assets/{slot}': {
      put: {
        operationId: 'uploadBrandAsset',
        summary: 'Replace the image in one brand slot',
        description:
          `Requires company.profile.manage. The body is the image (PNG or JPEG, at most ` +
          `${BRAND_ASSET_MAX_BYTES} bytes). The bytes are verified by their magic numbers; the ` +
          'declared type is never trusted. The previous image is superseded, never deleted.',
        parameters: [slotParameter],
        requestBody: {
          required: true,
          content: {
            'image/png': { schema: { type: 'string', format: 'binary' } },
            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
          },
        },
        responses: {
          '200': h.json('CompanyProfile', 'The profile with the new image reference'),
          '413': h.json('ErrorResponse', 'Larger than the limit (PAYLOAD_TOO_LARGE)'),
          ...h.conflictErrors,
        },
      },
    },
  };
}
