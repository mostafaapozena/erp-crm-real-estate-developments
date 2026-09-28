/**
 * Settings module published interface (PLAT-024, PLAT-025, PLAT-026).
 *
 * Other modules read their configuration through `SettingsService` — `valueOf`, `isEnabled`,
 * `activeCodes`, `effectiveTaxRate` — never through its collections.
 */
export {
  REFERENCE_ITEMS_COLLECTION,
  SETTING_REVISIONS_COLLECTION,
  SETTING_VALUES_COLLECTION,
  referenceItemModel,
  settingRevisionModel,
  settingValueModel,
} from './model';
export { SettingsService } from './service';
export { REFERENCE_IMPORT_COLUMNS, referenceItemImporter } from './importer';
export type { ReferenceImportRow } from './importer';
export type { SettingsServiceOptions } from './service';
export { referenceDataRouter, settingsRouter } from './router';
export type { SettingsRouterOptions } from './router';
