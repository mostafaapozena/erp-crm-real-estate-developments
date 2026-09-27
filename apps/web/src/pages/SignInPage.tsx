import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useSession } from '../api/session';
import { useBranding } from '../branding';
import { useLocale } from '../locale';
import { BrandMark } from '../shell/BrandMark';
import { useErrorMessage } from '../errors';

/**
 * Sign-in, and the second factor when the account requires one.
 *
 * The two live on one screen because they are one act: a privileged account that signs in without its
 * second factor has not signed in (`SEC-017`), and sending the person to a different page between the
 * two steps loses the challenge if they reload.
 *
 * No error text is written here. The API returns a stable code and `useErrorMessage` localizes it, so
 * an English sentence can never land on an Arabic screen (I18N-008).
 */
export function SignInPage() {
  const { otherLocale, setLocale, t } = useLocale();
  const branding = useBranding();
  const { status, signIn, verifyMfa } = useSession();
  const errorMessage = useErrorMessage();
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();

  const mfa = status === 'mfaRequired';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      if (mfa) await verifyMfa(code);
      else await signIn(loginIdentifier, password);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, 'NETWORK_ERROR'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default',
        paddingInline: 2,
        paddingBlock: 4,
      }}
    >
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 440, padding: { xs: 3, sm: 4 } }}>
        <Stack spacing={3} component="form" onSubmit={(event) => void submit(event)} noValidate>
          {/*
            The language switch belongs here, not only inside the shell: a person who cannot read the
            sign-in screen cannot reach the switch that would fix it.
          */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <BrandMark variant="signIn" />
            {otherLocale ? (
              <Button
                size="small"
                variant="outlined"
                lang={otherLocale}
                onClick={() => setLocale(otherLocale)}
                sx={{ flexShrink: 0 }}
              >
                {t('shell.switchLanguage')}
              </Button>
            ) : null}
          </Box>

          <Box>
            <Typography variant="h1" component="h1" sx={{ fontSize: '1.5rem' }}>
              {mfa ? t('auth.mfaTitle') : t('auth.signInTitle')}
            </Typography>
            <Typography color="text.secondary" sx={{ marginBlockStart: 0.5 }}>
              {mfa ? t('auth.mfaSubtitle') : t('auth.signInSubtitle')}
            </Typography>
          </Box>

          {/*
            Stated on the sign-in screen itself, so nobody mistakes a demonstration for a live system
            — and shown only on a demonstration deployment, so a client's live system never claims
            to be one (ADR-0026, ADR-0027).
          */}
          {branding.demonstration ? (
            <Alert severity="info" variant="outlined">
              {t('auth.demoNotice')}
            </Alert>
          ) : null}

          {error ? (
            <Alert severity="error" variant="outlined" role="alert">
              {errorMessage(error)}
            </Alert>
          ) : null}

          {mfa ? (
            <TextField
              label={t('auth.mfaCode')}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoFocus
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              // A code is Latin digits whatever the interface language is.
              slotProps={{ htmlInput: { dir: 'ltr' } }}
            />
          ) : (
            <>
              <TextField
                label={t('auth.loginIdentifier')}
                value={loginIdentifier}
                onChange={(event) => setLoginIdentifier(event.target.value)}
                autoFocus
                required
                autoComplete="username"
                slotProps={{ htmlInput: { dir: 'ltr' } }}
              />
              <TextField
                label={t('auth.password')}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
                slotProps={{ htmlInput: { dir: 'ltr' } }}
              />
            </>
          )}

          <Button type="submit" variant="contained" size="large" disabled={pending}>
            {pending ? t('auth.signingIn') : mfa ? t('auth.verify') : t('auth.signIn')}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
