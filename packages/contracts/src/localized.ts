import { z } from 'zod';

export const SUPPORTED_LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ar';
export const LocaleSchema = z.enum(SUPPORTED_LOCALES);

/**
 * Every administrator-configurable label is bilingual by shape (I18N-009): both languages required,
 * neither empty, nothing else accepted. User-entered content (names, notes, addresses) is never
 * stored this way — it is stored exactly as entered and never machine-translated.
 */
export const LocalizedLabelSchema = z.strictObject({
  ar: z.string().trim().min(1),
  en: z.string().trim().min(1),
});
export type LocalizedLabel = z.infer<typeof LocalizedLabelSchema>;
