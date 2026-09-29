import Box from '@mui/material/Box';
import { StateView } from '@alola/ui';
import type { i18n } from 'i18next';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { SessionProvider, useSession } from './api/session';
import { BrandingProvider } from './branding';
import { LocaleProvider, useLocale } from './locale';
import { SignInPage } from './pages/SignInPage';
import { AppRoutes, PAGE_MODULES } from './routes';
import { AppShell } from './shell/AppShell';

/** The public verification page (CORE-DOC-005): its own chunk, loaded only when a QR code is opened. */
const VerifyPage = lazy(PAGE_MODULES.Verify);

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

/**
 * `BrandingProvider` is outermost because the deployment's branding decides the starting language
 * and the brand colour the locale provider builds its theme from (PLAT-023, ADR-0027).
 */
export function App({ i18n }: { i18n: i18n }) {
  return (
    <BrandingProvider>
      <LocaleProvider i18n={i18n}>
        <BrowserRouter>
          <Routes>
            {/*
              A scanned QR code opens this route. It sits outside the session provider, so no session
              is probed and no refresh cookie is presented: the answer is the same for everyone.
            */}
            <Route
              path="/verify/:token"
              element={
                <Suspense fallback={null}>
                  <VerifyPage />
                </Suspense>
              }
            />
            <Route
              path="*"
              element={
                <SessionProvider>
                  <Authenticated />
                </SessionProvider>
              }
            />
          </Routes>
        </BrowserRouter>
      </LocaleProvider>
    </BrandingProvider>
  );
}
