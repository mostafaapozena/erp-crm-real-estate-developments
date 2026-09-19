import { LtrIsolate, StateView, type StateKind } from '@alola/ui';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale } from '../locale';

/** Synthetic sample values — not user data, not translatable. */
const SAMPLE_PHONE = '+201001234567';
const SAMPLE_EMAIL = 'sales@example.test';

const STATES: readonly StateKind[] = ['loading', 'empty', 'error', 'forbidden', 'success'];

/**
 * Phase 1 foundation page: demonstrates the shared states (THEME-010), bidirectional isolation
 * (I18N-005), pluralization (I18N-006), and brand interaction states — in both locales. It holds no
 * business data.
 */
export function FoundationPage() {
  const { t } = useLocale();

  return (
    <Stack spacing={4} sx={{ maxWidth: 1100 }}>
      <Box>
        <Typography variant="h1" gutterBottom>
          {t('foundation.title')}
        </Typography>
        <Typography color="text.secondary">{t('foundation.description')}</Typography>
      </Box>

      <Box component="section" aria-labelledby="states-heading">
        <Typography id="states-heading" variant="h2" gutterBottom>
          {t('foundation.statesHeading')}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
          }}
        >
          {STATES.map((kind) => (
            <StateView
              key={kind}
              kind={kind}
              title={t(`states.${kind}Title`)}
              description={t(`states.${kind}Description`)}
              action={
                kind === 'error' ? (
                  <Button variant="contained">{t('states.retry')}</Button>
                ) : undefined
              }
            />
          ))}
        </Box>
      </Box>

      <Box component="section" aria-labelledby="bidi-heading">
        <Typography id="bidi-heading" variant="h2" gutterBottom>
          {t('foundation.bidiHeading')}
        </Typography>
        <Box
          component="dl"
          sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 1, margin: 0 }}
        >
          <Typography component="dt" color="text.secondary">
            {t('foundation.phoneLabel')}
          </Typography>
          <Typography component="dd" sx={{ margin: 0 }} data-testid="phone-value">
            <LtrIsolate>{SAMPLE_PHONE}</LtrIsolate>
          </Typography>
          <Typography component="dt" color="text.secondary">
            {t('foundation.emailLabel')}
          </Typography>
          <Typography component="dd" sx={{ margin: 0 }}>
            <LtrIsolate>{SAMPLE_EMAIL}</LtrIsolate>
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} sx={{ marginBlockStart: 3, alignItems: 'center' }}>
          <Button variant="contained">{t('foundation.actionLabel')}</Button>
          <Typography data-testid="plural-sample">
            {t('foundation.itemsCount', { count: 3 })}
          </Typography>
        </Stack>
      </Box>
    </Stack>
  );
}
