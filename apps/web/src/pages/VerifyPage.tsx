import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { PublicVerification, VerificationResult } from '@alola/contracts';
import { Icon, StateView, StatusChip, elevation, tokens, type StatusTone } from '@alola/ui';
import { Languages, ShieldCheck } from '@alola/ui/icons';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { BrandMark } from '../shell/BrandMark';
import { Field, Verbatim } from './shared';

const RESULT_TONES: Record<VerificationResult, StatusTone> = {
  valid: 'success',
  superseded: 'warning',
  expired: 'warning',
  revoked: 'danger',
  invalid: 'danger',
};

type Load =
  | { status: 'loading' }
  | { status: 'ready'; data: PublicVerification }
  | { status: 'failed'; throttled: boolean };

/**
 * The public page a document's QR code opens (CORE-DOC-005).
 *
 * It is rendered **outside** the signed-in application: no session is probed, no refresh cookie is
 * presented and no access token is sent, so a customer or a bank officer scanning a printed page sees
 * the answer without an account, and a signed-in employee sees exactly what a stranger would. The
 * request is a plain `fetch`, deliberately not the application client, whose 401 handling would try a
 * refresh.
 *
 * What it shows is the server's whole public answer and nothing else: who issued the document, its
 * type, business reference, issue date, version and fingerprint, and whether it still stands. The
 * fingerprint is there to be compared with the one printed on the page in hand.
 */
export default function VerifyPage() {
  const { token = '' } = useParams();
  const { otherLocale, setLocale, t } = useLocale();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setLoad({ status: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/public/verify/${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setLoad({ status: 'failed', throttled: response.status === 429 });
          return;
        }
        setLoad({ status: 'ready', data: (await response.json()) as PublicVerification });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ status: 'failed', throttled: false });
      });
    return () => controller.abort();
  }, [token, attempt]);

  // A verification page has no business in a search index, and its title names what it is.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = t('verify.title');
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    return () => {
      document.title = previousTitle;
      robots.remove();
    };
  }, [t]);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        backgroundImage: `linear-gradient(to bottom, ${tokens.primarySoft} 0, ${tokens.primarySoft} 240px, transparent 240px)`,
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
          justifyContent: 'center',
          paddingInline: 2,
          paddingBlockEnd: 6,
        }}
      >
        <Stack spacing={3} sx={{ inlineSize: '100%', maxInlineSize: 560 }}>
          <BrandMark variant="signIn" />
          <Paper
            variant="outlined"
            sx={{ padding: { xs: 3, sm: 4 }, boxShadow: elevation.overlay }}
          >
            <Stack spacing={2.5}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Box sx={{ color: 'primary.main', display: 'flex' }}>
                  <Icon icon={ShieldCheck} size={24} />
                </Box>
                <Typography variant="h1" component="h1" sx={{ fontSize: '1.375rem' }}>
                  {t('verify.title')}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t('verify.lead')}
              </Typography>

              {load.status === 'loading' ? (
                <StateView kind="loading" title={t('verify.loading')} variant="inline" />
              ) : load.status === 'failed' ? (
                <StateView
                  kind="error"
                  title={load.throttled ? t('verify.throttled') : t('verify.failed')}
                  variant="inline"
                  action={
                    <Button variant="outlined" onClick={retry}>
                      {t('states.retry')}
                    </Button>
                  }
                />
              ) : (
                <Result data={load.data} />
              )}

              <Divider />
              <Typography variant="caption" color="text.secondary" component="p">
                {t('verify.privacy')}
              </Typography>
            </Stack>
          </Paper>
        </Stack>
      </Box>
    </Box>
  );
}

function Result({ data }: { data: PublicVerification }) {
  const { locale, t } = useLocale();
  const format = useFormatters();
  return (
    <Stack spacing={2.5} data-testid="verification-result" data-result={data.result}>
      <Box role="status">
        <StatusChip
          tone={RESULT_TONES[data.result]}
          size="medium"
          label={t(`verificationResult.${data.result}`)}
        />
        <Typography variant="body2" sx={{ marginBlockStart: 1.5 }}>
          {t(`verify.describe.${data.result}`)}
        </Typography>
      </Box>
      {data.result === 'invalid' ? null : (
        <>
          <Box
            sx={{
              display: 'grid',
              columnGap: 3,
              rowGap: 2,
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
            }}
          >
            {data.company ? (
              <Field label={t('verify.field.company')}>
                <bdi>{data.company[locale]}</bdi>
              </Field>
            ) : null}
            {data.documentType ? (
              <Field label={t('verify.field.type')}>
                {t(`issuedDocumentType.${data.documentType}`)}
              </Field>
            ) : null}
            {data.businessReference ? (
              <Field label={t('verify.field.reference')}>
                <Verbatim>{data.businessReference}</Verbatim>
              </Field>
            ) : null}
            {data.issuedOn ? (
              <Field label={t('verify.field.issuedOn')}>
                <Verbatim>{format.date(data.issuedOn)}</Verbatim>
              </Field>
            ) : null}
            {data.version ? (
              <Field label={t('verify.field.version')}>
                <Verbatim>{format.number(data.version)}</Verbatim>
              </Field>
            ) : null}
            {data.fingerprint ? (
              <Field label={t('verify.field.fingerprint')}>
                <Verbatim>{data.fingerprint}</Verbatim>
              </Field>
            ) : null}
          </Box>
          {data.fingerprint ? <Alert severity="info">{t('verify.compare')}</Alert> : null}
        </>
      )}
      <Typography variant="caption" color="text.secondary" component="p">
        {t('verify.field.checkedAt')}: <Verbatim>{format.dateTime(data.checkedAt)}</Verbatim>
      </Typography>
    </Stack>
  );
}
