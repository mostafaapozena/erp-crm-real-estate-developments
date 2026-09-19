import Box from '@mui/material/Box';
import { useLocale } from '../locale';

/**
 * Temporary **text** placeholder for the logo (SD-17, open). Development builds only; it is never
 * rendered in a production build and must never reach a customer-facing document. It is not an image
 * and imitates no logo — it says, in the current language, that it is temporary.
 */
export function DevLogoPlaceholder() {
  const { t } = useLocale();
  return (
    <Box
      component="span"
      data-testid="dev-logo-placeholder"
      title={t('shell.logoPlaceholderHint')}
      sx={{
        paddingInline: 1,
        paddingBlock: 0.25,
        border: 1,
        borderStyle: 'dashed',
        borderColor: 'secondary.main',
        borderRadius: 1,
        color: 'text.secondary',
        typography: 'caption',
        whiteSpace: 'nowrap',
      }}
    >
      {t('shell.logoPlaceholder')}
    </Box>
  );
}
