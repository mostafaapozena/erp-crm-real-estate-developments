import arCommon from './locales/ar/common.json';
import arErrors from './locales/ar/errors.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import type { Locale } from '@alola/contracts';

/**
 * Translation resources, one namespace per module (I18N-001). Both locales ship in the same change;
 * `checkResources` fails the build on any missing, extra, or empty key (I18N-002).
 */
export const NAMESPACES = ['common', 'errors'] as const;
export type Namespace = (typeof NAMESPACES)[number];
export const DEFAULT_NAMESPACE: Namespace = 'common';

export type ResourceTree = { readonly [key: string]: string | ResourceTree };

export const resources = {
  ar: { common: arCommon, errors: arErrors },
  en: { common: enCommon, errors: enErrors },
} as const satisfies Record<Locale, Record<Namespace, ResourceTree>>;
