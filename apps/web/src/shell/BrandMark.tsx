import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { brandName, useBranding } from '../branding';
import { useLocale } from '../locale';
import { DevLogoPlaceholder } from './DevLogoPlaceholder';

/**
 * The company's mark: its configured logo and name, or the neutral product name (PLAT-023).
 *
 * The image carries the company name as its text alternative, so a screen reader announces the same
 * identity a sighted person sees. Without a configured logo, a development build shows the labelled
 * placeholder and a production build shows the name alone — never another company's mark.
 */
export function BrandMark({ variant }: { variant: 'shell' | 'signIn' }) {
  const branding = useBranding();
  const { locale, t } = useLocale();
  const name = brandName(branding, locale) ?? t('app.title');
  const asset = variant === 'shell' ? branding.assets.compactLogo : branding.assets.logo;
  const height = variant === 'shell' ? 32 : 56;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      {asset ? (
        <Box
          component="img"
          src={asset.url}
          alt={name}
          data-testid="brand-logo"
          sx={{ height, width: 'auto', maxWidth: 200, objectFit: 'contain', flexShrink: 0 }}
        />
      ) : import.meta.env.PROD ? null : (
        <DevLogoPlaceholder />
      )}
      <Typography
        component="p"
        variant={variant === 'shell' ? 'h6' : 'subtitle1'}
        noWrap
        sx={{ fontWeight: 700 }}
        // The image already announces the name; the text would say it twice.
        {...(asset ? { 'aria-hidden': true } : {})}
      >
        {name}
      </Typography>
    </Box>
  );
}
