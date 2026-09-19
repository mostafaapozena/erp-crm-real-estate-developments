import type { i18n } from 'i18next';
import { LocaleProvider } from './locale';
import { FoundationPage } from './pages/FoundationPage';
import { AppShell } from './shell/AppShell';

export function App({ i18n }: { i18n: i18n }) {
  return (
    <LocaleProvider i18n={i18n}>
      <AppShell>
        <FoundationPage />
      </AppShell>
    </LocaleProvider>
  );
}
