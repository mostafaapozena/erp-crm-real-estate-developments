import type { resources } from '@alola/i18n';

// Typed translation keys: a key that does not exist in the Arabic resources fails typecheck.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof resources)['ar'];
  }
}
