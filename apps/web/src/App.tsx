import Box from '@mui/material/Box';
import { StateView } from '@alola/ui';
import type { i18n } from 'i18next';
import { BrowserRouter } from 'react-router';
import { SessionProvider, useSession } from './api/session';
import { LocaleProvider, useLocale } from './locale';
import { SignInPage } from './pages/SignInPage';
import { AppRoutes } from './routes';
import { AppShell } from './shell/AppShell';

/**
 * The application root.
 *
 * `LocaleProvider` is outermost because **everything** below it depends on the locale: the text, the
 * direction, the theme and the fonts are all derived from that one value, so nothing can render in a
 * half-switched state (I18N-003).
 *
 * The router sits inside the session provider so a signed-out person sees the sign-in screen rather
 * than a shell full of empty tables — and so a session that ends mid-session returns them to it.
 */
function Authenticated() {
  const { status } = useSession();
  const { t } = useLocale();

  if (status === 'loading') {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <StateView
          kind="loading"
          title={t('states.loadingTitle')}
          description={t('states.loadingDescription')}
        />
      </Box>
    );
  }

  if (status !== 'signedIn') return <SignInPage />;

  return (
    <AppShell>
      <AppRoutes />
    </AppShell>
  );
}

export function App({ i18n }: { i18n: i18n }) {
  return (
    <LocaleProvider i18n={i18n}>
      <BrowserRouter>
        <SessionProvider>
          <Authenticated />
        </SessionProvider>
      </BrowserRouter>
    </LocaleProvider>
  );
}
