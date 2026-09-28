import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Icon, elevation, tokens } from '@alola/ui';
import { Eye, EyeOff, FlaskConical, Languages, ShieldCheck } from '@alola/ui/icons';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useSession } from '../api/session';
import { useBranding } from '../branding';
import { useErrorMessage } from '../errors';
import { useLocale } from '../locale';
import { BrandMark } from '../shell/BrandMark';

/**
 * Sign-in, and the second factor when the account requires one.
 *
 * The two live on one screen because they are one act: a privileged account that signs in without its
 * second factor has not signed in (`SEC-017`), and sending the person to a different page between the
 * two steps loses the challenge if they reload.
 *
 * The screen carries the company's identity — its mark and name come from the deployment's branding,
 * never from the source — and it is deliberately quiet: one card, no stock imagery, no motion.
 *
 * No error text is written here. The API returns a stable code and `useErrorMessage` localizes it, so
 * an English sentence can never land on an Arabic screen (I18N-008). There is no "forgot password"
 * link: self-service reset delivery needs a connected e-mail or SMS provider, which does not exist,
 * and a link to nothing would be a promise the product cannot keep.
 */
export function SignInPage() {
  const { otherLocale, setLocale, t } = useLocale();
  const branding = useBranding();
  const { status, signIn, verifyMfa } = useSession();
  const errorMessage = useErrorMessage();
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();

  const mfa = status === 'mfaRequired';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
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
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        // A quiet band of the brand colour behind the card: identity without decoration.
        backgroundImage: `linear-gradient(to bottom, ${tokens.primarySoft} 0, ${tokens.primarySoft} 280px, transparent 280px)`,
      }}
    >
      <Box
        component="header"
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          paddingInline: { xs: 2, sm: 3 },
          paddingBlock: 2,
        }}
      >
        {/*
          The language switch belongs here, not only inside the shell: a person who cannot read the
          sign-in screen cannot reach the switch that would fix it.
        */}
        {otherLocale ? (
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            lang={otherLocale}
            onClick={() => setLocale(otherLocale)}
            startIcon={<Icon icon={Languages} size={16} />}
            sx={{ bgcolor: 'background.paper' }}
          >
            {t('shell.switchLanguage')}
          </Button>
        ) : null}
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'center',
          paddingInline: 2,
          paddingBlockEnd: 6,
        }}
      >
        <Stack spacing={3} sx={{ inlineSize: '100%', maxInlineSize: 440 }}>
          <BrandMark variant="signIn" />

          <Paper
            variant="outlined"
            sx={{ padding: { xs: 3, sm: 4 }, boxShadow: elevation.overlay }}
          >
            <Stack
              spacing={2.5}
              component="form"
              onSubmit={(event) => void submit(event)}
              noValidate
            >
              <Box>
                <Typography variant="h1" component="h1" sx={{ fontSize: '1.375rem' }}>
                  {mfa ? t('auth.mfaTitle') : t('auth.signInTitle')}
                </Typography>
                <Typography color="text.secondary" variant="body2" sx={{ marginBlockStart: 0.5 }}>
                  {mfa ? t('auth.mfaSubtitle') : t('auth.signInSubtitle')}
                </Typography>
              </Box>

              {error ? (
                <Alert severity="error" variant="outlined" role="alert">
                  {errorMessage(error)}
                </Alert>
              ) : null}

              {mfa ? (
                <TextField
                  size="medium"
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
                    size="medium"
                    label={t('auth.loginIdentifier')}
                    value={loginIdentifier}
                    onChange={(event) => setLoginIdentifier(event.target.value)}
                    autoFocus
                    required
                    autoComplete="username"
                    slotProps={{ htmlInput: { dir: 'ltr' } }}
                  />
                  <TextField
                    size="medium"
                    label={t('auth.password')}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete="current-password"
                    slotProps={{
                      htmlInput: { dir: 'ltr' },
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              edge="end"
                              aria-label={
                                showPassword ? t('auth.hidePassword') : t('auth.showPassword')
                              }
                              aria-pressed={showPassword}
                              onClick={() => setShowPassword((value) => !value)}
                            >
                              <Icon icon={showPassword ? EyeOff : Eye} size={20} />
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                </>
              )}

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={pending}
                aria-busy={pending || undefined}
                startIcon={
                  pending ? <CircularProgress aria-hidden size={18} color="inherit" /> : undefined
                }
              >
                {pending ? t('auth.signingIn') : mfa ? t('auth.verify') : t('auth.signIn')}
              </Button>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  color: 'text.secondary',
                  typography: 'caption',
                }}
              >
                <Icon icon={ShieldCheck} size={16} />
                {t('auth.secureNote')}
              </Box>
            </Stack>
          </Paper>

          {/*
            Stated on the sign-in screen itself, so nobody mistakes a demonstration for a live system
            — and shown only on a demonstration deployment, so a client's live system never claims
            to be one (ADR-0026, ADR-0027).
          */}
          {branding.demonstration ? (
            <Alert
              severity="info"
              variant="outlined"
              icon={<Icon icon={FlaskConical} size={20} />}
              sx={{ bgcolor: 'background.paper' }}
            >
              {t('auth.demoNotice')}
            </Alert>
          ) : null}
        </Stack>
      </Box>
    </Box>
  );
}
