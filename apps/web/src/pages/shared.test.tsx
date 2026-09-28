import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NEUTRAL_BRANDING, BrandingProvider } from '../branding';
import { createI18n } from '../i18n';
import { LocaleProvider } from '../locale';
import { FieldGroup, SystemNote, parseSystemReference } from './shared';

/**
 * The sales service stores a few machine-written English references as lead activity bodies and unit
 * history reasons. They stay as stored; on screen the record type and outcome are translated and the
 * reference is an isolated technical value.
 */
afterEach(cleanup);

function renderIn(locale: 'ar' | 'en', ui: React.ReactNode) {
  const branding = { ...NEUTRAL_BRANDING, defaultLocale: locale };
  return render(
    <BrandingProvider initial={branding}>
      <LocaleProvider i18n={createI18n(() => undefined)}>{ui}</LocaleProvider>
    </BrandingProvider>,
  );
}

describe('parseSystemReference', () => {
  it('recognises exactly the formats the sales service writes', () => {
    expect(parseSystemReference('contract CTR-2026-00002')).toEqual({
      type: 'contract',
      reference: 'CTR-2026-00002',
    });
    expect(parseSystemReference('reservation RSV-2026-00002 confirmed')).toEqual({
      type: 'reservation',
      reference: 'RSV-2026-00002',
      outcome: 'confirmed',
    });
    expect(parseSystemReference('contract CTR-2026-00001 cancelled')?.outcome).toBe('cancelled');
  });

  it('leaves anything else alone', () => {
    for (const text of [
      'تعاقد على وحدة',
      'contract signed today',
      'contracts CTR-2026-00002',
      '',
    ]) {
      expect(parseSystemReference(text)).toBeUndefined();
    }
  });
});

describe('SystemNote', () => {
  it('translates the record type in Arabic and isolates the reference', () => {
    renderIn('ar', <SystemNote text="contract CTR-2026-00002" />);
    expect(screen.getByText('عقد')).toBeDefined();
    const reference = screen.getByText('CTR-2026-00002');
    expect(reference.tagName).toBe('BDI');
    expect(reference.getAttribute('dir')).toBe('ltr');
    expect(document.body.textContent).not.toMatch(/contract/);
  });

  it('translates the outcome too', () => {
    renderIn('ar', <SystemNote text="reservation RSV-2026-00002 confirmed" />);
    expect(screen.getByText('حجز')).toBeDefined();
    expect(document.body.textContent).toContain('تم التأكيد');
    expect(document.body.textContent).not.toMatch(/reservation|confirmed/);
  });

  it('reads naturally in English', () => {
    renderIn('en', <SystemNote text="contract CTR-2026-00002" />);
    expect(screen.getByText('Contract')).toBeDefined();
  });

  it('shows free text unchanged', () => {
    renderIn('ar', <SystemNote text="تعاقد على وحدة بإطلالة بانورامية." />);
    expect(screen.getByText('تعاقد على وحدة بإطلالة بانورامية.')).toBeDefined();
  });
});

describe('FieldGroup', () => {
  it('is a labelled section whose fields sit in at most three columns', () => {
    renderIn(
      'ar',
      <FieldGroup title="بيانات الاتصال">
        <span>أ</span>
        <span>ب</span>
      </FieldGroup>,
    );
    const group = screen.getByRole('region', { name: 'بيانات الاتصال' });
    expect(screen.getByRole('heading', { level: 3, name: 'بيانات الاتصال' })).toBeDefined();
    expect(group.querySelectorAll('span')).toHaveLength(2);
  });
});
