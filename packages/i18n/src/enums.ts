import {
  ACTIVITY_KINDS,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_STATES,
  CONTRACT_STATES,
  FINISHING_STATUSES,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_KINDS,
  INSTALLMENT_STATES,
  INSTRUMENT_KINDS,
  INSTRUMENT_STATES,
  LEAD_SOURCES,
  LEAD_STAGES,
  PAYMENT_METHODS,
  PROJECT_STATUSES,
  PROPERTY_TYPES,
  RECEIPT_STATES,
  REMINDER_CHANNELS,
  REMINDER_STATES,
  RESERVATION_STATES,
  SUPPORTED_LOCALES,
  UNIT_STATUSES,
  USAGE_TYPES,
  type Locale,
} from '@alola/contracts';
import type { ResourceTree } from './resources';

/**
 * Every domain enumeration the interface displays, keyed by the `common` namespace object that labels
 * it (I18N-002, I18N-008).
 *
 * A label such as `receiptState.reversed` is looked up with a key built at runtime, so the typed `t`
 * cannot check it and the key-parity check cannot either — parity only compares Arabic with English,
 * and a namespace missing from **both** languages is perfectly symmetrical. That is exactly how the
 * receipt state reached the screen untranslated. This registry closes the gap: each entry is the
 * contract's own value list, so a value added to a contract without a label in both languages fails
 * `npm run check:i18n`.
 *
 * Add a row here in the same change that renders a new enumeration.
 */
export const DISPLAYED_ENUMS: Readonly<Record<string, readonly string[]>> = {
  leadStage: LEAD_STAGES,
  leadSource: LEAD_SOURCES,
  activityKind: ACTIVITY_KINDS,
  unitStatus: UNIT_STATUSES,
  projectStatus: PROJECT_STATUSES,
  propertyType: PROPERTY_TYPES,
  usageType: USAGE_TYPES,
  finishingStatus: FINISHING_STATUSES,
  reservationState: RESERVATION_STATES,
  contractState: CONTRACT_STATES,
  installmentState: INSTALLMENT_STATES,
  installmentKind: INSTALLMENT_KINDS,
  frequency: INSTALLMENT_FREQUENCIES,
  paymentMethod: PAYMENT_METHODS,
  receiptState: RECEIPT_STATES,
  instrumentKind: INSTRUMENT_KINDS,
  instrumentState: INSTRUMENT_STATES,
  reminderState: REMINDER_STATES,
  reminderChannel: REMINDER_CHANNELS,
  campaignPlatform: CAMPAIGN_PLATFORMS,
  campaignObjective: CAMPAIGN_OBJECTIVES,
  campaignState: CAMPAIGN_STATES,
};

export interface EnumLabelProblem {
  locale: Locale;
  key: string;
  problem: 'missing-enum-label';
}

/** Report every displayed enum value that lacks a non-empty label in either language. */
export function checkEnumLabels(
  all: Record<Locale, Record<string, ResourceTree>>,
  enums: Readonly<Record<string, readonly string[]>> = DISPLAYED_ENUMS,
  namespace = 'common',
): EnumLabelProblem[] {
  const problems: EnumLabelProblem[] = [];
  for (const locale of SUPPORTED_LOCALES) {
    const tree = all[locale][namespace] ?? {};
    for (const [group, values] of Object.entries(enums)) {
      const labels = tree[group];
      for (const value of values) {
        const label = typeof labels === 'object' ? labels[value] : undefined;
        if (typeof label !== 'string' || label.trim() === '') {
          problems.push({ locale, key: `${group}.${value}`, problem: 'missing-enum-label' });
        }
      }
    }
  }
  return problems;
}
