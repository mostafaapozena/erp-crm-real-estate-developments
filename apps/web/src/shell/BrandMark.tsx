import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { brandDisplayName, brandName, initialsOf, useBranding } from '../branding';
import { useLocale } from '../locale';

/**
 * The company's mark: its configured logo and name, or the neutral product identity (PLAT-023).
 *
 * Nothing about a client is compiled in. The name, the images and the colour come from the
 * deployment's company profile at runtime; with nothing configured, the product's own neutral title
 * shows, with a monogram drawn from the theme's primary colour — never another company's mark.
 *
 * The image carries the company name as its text alternative, so a screen reader announces the same
 * identity a sighted person sees; the visible name beside it is then hidden from assistive technology
 * so it is not read twice.
 *
 * - `sidebar` — logo, display name and the product descriptor, at the top of the navigation.
 * - `compact` — the compact logo or monogram alone, for the collapsed sidebar.
 * - `signIn` — a larger, centred block above the sign-in form.
 */
export function BrandMark({ variant }: { variant: 'sidebar' | 'compact' | 'signIn' }) {
  const branding = useBranding();
  const { locale, t } = useLocale();
  const configuredName = brandDisplayName(branding, locale);
  const name = configuredName ?? t('app.title');
  const short = brandName(branding, locale) ?? name;
  const asset =
    variant === 'compact'
      ? (branding.assets.compactLogo ?? branding.assets.logo)
      : (branding.assets.logo ?? branding.assets.compactLogo);
  const markSize = variant === 'signIn' ? 56 : variant === 'compact' ? 40 : 40;
  const centred = variant === 'signIn';

  const mark = asset ? (
    <Box
      component="img"
      src={asset.url}
      alt={name}
      data-testid="brand-logo"
      sx={{
        blockSize: markSize,
        inlineSize: 'auto',
        maxInlineSize: variant === 'compact' ? markSize : variant === 'signIn' ? 220 : 120,
        objectFit: 'contain',
        flexShrink: 0,
      }}
    />
  ) : (
    <Box
      aria-hidden
      data-testid="brand-monogram"
      sx={{
        display: 'grid',
        placeItems: 'center',
        inlineSize: markSize,
        blockSize: markSize,
        flexShrink: 0,
        borderRadius: 2.5,
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        fontWeight: 700,
        fontSize: markSize >= 56 ? '1.5rem' : '1.125rem',
        lineHeight: 1,
      }}
    >
      {initialsOf(short).slice(0, configuredName ? 1 : 2) || '·'}
    </Box>
  );

  if (variant === 'compact') {
    return asset ? mark : <Box sx={{ display: 'flex' }}>{mark}</Box>;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: centred ? 'column' : 'row',
        alignItems: 'center',
        textAlign: centred ? 'center' : 'start',
        gap: centred ? 1.5 : 1.25,
        minWidth: 0,
      }}
    >
      {mark}
      <Box sx={{ minWidth: 0 }} {...(asset ? { 'aria-hidden': true } : {})}>
        <Typography
          component="p"
          sx={{
            fontWeight: 700,
            fontSize: centred ? '1.25rem' : '0.9375rem',
            lineHeight: 1.35,
            color: 'text.primary',
            ...(centred
              ? {}
              : {
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }),
          }}
        >
          {name}
        </Typography>
        {/* Only beside a configured company name: unconfigured, the name already is the product. */}
        {configuredName ? (
          <Typography
            component="p"
            variant="caption"
            color="text.secondary"
            sx={{ lineHeight: 1.4, marginBlockStart: 0.25 }}
          >
            {t('shell.productDescriptor')}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
