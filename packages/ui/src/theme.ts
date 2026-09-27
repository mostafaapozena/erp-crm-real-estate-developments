import { createTheme, type Theme } from '@mui/material/styles';
import { localeSettings, type Locale } from '@alola/i18n';
import type { Palette } from './brand';
import { focusRingWidthPx, tokens } from './tokens';

/**
 * The single centralized Light Mode theme (THEME-001, THEME-002). There is no `colorSchemes`, no dark
 * palette, and no mode switch. The inputs are the locale, which fixes direction and typography, and
 * the deployment's palette.
 *
 * `palette` defaults to the approved tokens. A deployment with a configured brand colour passes the
 * palette `derivePalette` built from it — already validated against every contrast pair in use
 * (THEME-013, ADR-0027) — and only the brand states differ; text, surfaces, borders and status colours
 * are the approved values in every deployment.
 *
 * Interaction states (THEME-004) are defined here once so that every component inherits default,
 * hover, pressed, selected, focus, and disabled treatment from the palette.
 */
export function createAppTheme(locale: Locale, palette: Palette = tokens): Theme {
  const settings = localeSettings(locale);
  const focusOutline = {
    outline: `${focusRingWidthPx}px solid ${palette.focusRing}`,
    outlineOffset: 2,
  } as const;

  return createTheme({
    direction: settings.direction,
    palette: {
      mode: 'light',
      primary: {
        main: palette.primary,
        dark: palette.primaryHover,
        light: palette.primarySoftStrong,
        contrastText: palette.onPrimary,
      },
      secondary: {
        main: palette.secondaryText,
        dark: palette.mainText,
        light: palette.borderSubtle,
        contrastText: palette.surface,
      },
      success: {
        main: palette.success,
        light: palette.successSoft,
        dark: palette.success,
        contrastText: palette.surface,
      },
      warning: {
        main: palette.warning,
        light: palette.warningSoft,
        dark: palette.warning,
        contrastText: palette.surface,
      },
      error: {
        main: palette.error,
        light: palette.errorSoft,
        dark: palette.error,
        contrastText: palette.surface,
      },
      info: {
        main: palette.info,
        light: palette.infoSoft,
        dark: palette.info,
        contrastText: palette.surface,
      },
      text: {
        primary: palette.mainText,
        secondary: palette.secondaryText,
        disabled: palette.disabled,
      },
      background: { default: palette.pageBackground, paper: palette.surface },
      divider: palette.borderSubtle,
      common: { black: palette.mainText, white: palette.surface },
      action: {
        active: palette.secondaryText,
        hover: palette.primarySoft,
        selected: palette.primarySoft,
        focus: palette.primarySoft,
        disabled: palette.disabled,
        disabledBackground: palette.borderSubtle,
      },
    },
    // Only the self-hosted weights 400, 600, and 700 exist (I18N-007); every variant maps onto them.
    typography: {
      fontFamily: settings.fontFamily,
      fontWeightLight: 400,
      fontWeightRegular: 400,
      fontWeightMedium: 600,
      fontWeightBold: 700,
      h1: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.3 },
      h2: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.35 },
      h3: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.4 },
      h4: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
      h5: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
      h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
      subtitle1: { fontWeight: 600, lineHeight: settings.lineHeight },
      subtitle2: { fontWeight: 600, lineHeight: settings.lineHeight },
      body1: { lineHeight: settings.lineHeight },
      body2: { lineHeight: settings.lineHeight },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: palette.pageBackground,
            color: palette.mainText,
          },
          ':focus-visible': focusOutline,
        },
      },
      MuiButtonBase: {
        defaultProps: { disableRipple: false },
        styleOverrides: {
          // MUI removes the native outline; restore a visible, token-colored focus ring (THEME-011).
          root: { '&.Mui-focusVisible': focusOutline },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            variants: [
              {
                props: { variant: 'contained', color: 'primary' },
                style: {
                  '&:hover': { backgroundColor: palette.primaryHover },
                  '&:active': { backgroundColor: palette.primaryPressed },
                },
              },
              {
                props: { variant: 'outlined', color: 'primary' },
                style: {
                  borderColor: palette.primary,
                  '&:hover': {
                    backgroundColor: palette.primarySoft,
                    borderColor: palette.primaryHover,
                  },
                  '&:active': { backgroundColor: palette.primarySoftStrong },
                },
              },
              {
                props: { variant: 'text', color: 'primary' },
                style: {
                  '&:hover': { backgroundColor: palette.primarySoft },
                  '&:active': {
                    backgroundColor: palette.primarySoftStrong,
                    color: palette.mainText,
                  },
                },
              },
            ],
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color: palette.mainText,
            '&:hover': { backgroundColor: palette.primarySoft },
            '&:active': { backgroundColor: palette.primarySoftStrong },
          },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'always' },
        styleOverrides: {
          root: { color: palette.primary, '&:hover': { color: palette.primaryHover } },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            '&:hover': { backgroundColor: palette.primarySoft },
            // THEME-006: selected content uses mainText, never primary text, on the soft blues.
            '&.Mui-selected': {
              backgroundColor: palette.primarySoft,
              color: palette.mainText,
              boxShadow: `inset ${focusRingWidthPx}px 0 0 ${palette.primary}`,
            },
            '&.Mui-selected:hover': { backgroundColor: palette.primarySoftStrong },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          // THEME-007: a control boundary uses borderStrong, never borderSubtle.
          notchedOutline: { borderColor: palette.borderStrong },
          root: {
            backgroundColor: palette.surface,
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: palette.mainText },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          // THEME-008: placeholders use secondaryText at full opacity, never the disabled token.
          input: { '&::placeholder': { color: palette.secondaryText, opacity: 1 } },
        },
      },
      MuiTableCell: {
        styleOverrides: { root: { borderBottomColor: palette.borderSubtle } },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&.Mui-selected': { backgroundColor: palette.primarySoft },
            '&.Mui-selected:hover': { backgroundColor: palette.primarySoftStrong },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { backgroundColor: palette.mainText, color: palette.surface } },
      },
      MuiBackdrop: {
        styleOverrides: { root: { backgroundColor: palette.overlay } },
      },
      MuiPaper: {
        styleOverrides: { root: { backgroundColor: palette.surface, color: palette.mainText } },
      },
    },
  });
}
