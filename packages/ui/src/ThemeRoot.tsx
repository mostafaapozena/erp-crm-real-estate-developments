import createCache, { type EmotionCache } from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { directionOf, type Direction, type Locale } from '@alola/i18n';
import { useMemo, type ReactNode } from 'react';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import { createAppTheme } from './theme';

/**
 * Emotion caches per direction. In RTL, MUI's internal physical styles are mirrored by the stylis RTL
 * plugin; application code uses logical properties, which the plugin leaves untouched (I18N-004).
 */
export function createEmotionCache(direction: Direction): EmotionCache {
  return direction === 'rtl'
    ? createCache({ key: 'muirtl', stylisPlugins: [prefixer, rtlPlugin] })
    : createCache({ key: 'muiltr', stylisPlugins: [prefixer] });
}

const caches: Partial<Record<Direction, EmotionCache>> = {};

function cacheFor(direction: Direction): EmotionCache {
  return (caches[direction] ??= createEmotionCache(direction));
}

/**
 * Theme, direction-aware style cache, and baseline — all derived from one `locale` value so theme
 * direction, style mirroring, and font can never disagree (I18N-003).
 */
export function ThemeRoot({ locale, children }: { locale: Locale; children: ReactNode }) {
  const theme = useMemo(() => createAppTheme(locale), [locale]);
  return (
    <CacheProvider value={cacheFor(directionOf(locale))}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}
