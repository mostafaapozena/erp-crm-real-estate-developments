import { createTheme, type Theme } from '@mui/material/styles';
import { localeSettings, type Locale } from '@alola/i18n';
import { focusRingWidthPx, tokens } from './tokens';

const focusOutline = {
  outline: `${focusRingWidthPx}px solid ${tokens.focusRing}`,
  outlineOffset: 2,
} as const;

/**
 * The single centralized Light Mode theme (THEME-001, THEME-002). There is no `colorSchemes`, no dark
 * palette, and no mode switch. The only input is the locale, which fixes direction and typography.
 *
 * Interaction states (THEME-004) are defined here once so that every component inherits default,
 * hover, pressed, selected, focus, and disabled treatment from approved tokens.
 */
export function createAppTheme(locale: Locale): Theme {
  const settings = localeSettings(locale);

  return createTheme({
    direction: settings.direction,
    palette: {
      mode: 'light',
      primary: {
        main: tokens.primary,
        dark: tokens.primaryHover,
        light: tokens.primarySoftStrong,
        contrastText: tokens.onPrimary,
      },
      secondary: {
        main: tokens.secondaryText,
        dark: tokens.mainText,
        light: tokens.borderSubtle,
        contrastText: tokens.surface,
      },
      success: {
        main: tokens.success,
        light: tokens.successSoft,
        dark: tokens.success,
        contrastText: tokens.surface,
      },
      warning: {
        main: tokens.warning,
        light: tokens.warningSoft,
        dark: tokens.warning,
        contrastText: tokens.surface,
      },
      error: {
        main: tokens.error,
        light: tokens.errorSoft,
        dark: tokens.error,
        contrastText: tokens.surface,
      },
      info: {
        main: tokens.info,
        light: tokens.infoSoft,
        dark: tokens.info,
        contrastText: tokens.surface,
      },
      text: {
        primary: tokens.mainText,
        secondary: tokens.secondaryText,
        disabled: tokens.disabled,
      },
      background: { default: tokens.pageBackground, paper: tokens.surface },
      divider: tokens.borderSubtle,
      common: { black: tokens.mainText, white: tokens.surface },
      action: {
        active: tokens.secondaryText,
        hover: tokens.primarySoft,
        selected: tokens.primarySoft,
        focus: tokens.primarySoft,
        disabled: tokens.disabled,
        disabledBackground: tokens.borderSubtle,
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
            backgroundColor: tokens.pageBackground,
            color: tokens.mainText,
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
                  '&:hover': { backgroundColor: tokens.primaryHover },
                  '&:active': { backgroundColor: tokens.primaryPressed },
                },
              },
              {
                props: { variant: 'outlined', color: 'primary' },
                style: {
                  borderColor: tokens.primary,
                  '&:hover': {
                    backgroundColor: tokens.primarySoft,
                    borderColor: tokens.primaryHover,
                  },
                  '&:active': { backgroundColor: tokens.primarySoftStrong },
                },
              },
              {
                props: { variant: 'text', color: 'primary' },
                style: {
                  '&:hover': { backgroundColor: tokens.primarySoft },
                  '&:active': { backgroundColor: tokens.primarySoftStrong, color: tokens.mainText },
                },
              },
            ],
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color: tokens.mainText,
            '&:hover': { backgroundColor: tokens.primarySoft },
            '&:active': { backgroundColor: tokens.primarySoftStrong },
          },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'always' },
        styleOverrides: {
          root: { color: tokens.primary, '&:hover': { color: tokens.primaryHover } },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            '&:hover': { backgroundColor: tokens.primarySoft },
            // THEME-006: selected content uses mainText, never primary text, on the soft blues.
            '&.Mui-selected': {
              backgroundColor: tokens.primarySoft,
              color: tokens.mainText,
              boxShadow: `inset ${focusRingWidthPx}px 0 0 ${tokens.primary}`,
            },
            '&.Mui-selected:hover': { backgroundColor: tokens.primarySoftStrong },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          // THEME-007: a control boundary uses borderStrong, never borderSubtle.
          notchedOutline: { borderColor: tokens.borderStrong },
          root: {
            backgroundColor: tokens.surface,
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: tokens.mainText },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          // THEME-008: placeholders use secondaryText at full opacity, never the disabled token.
          input: { '&::placeholder': { color: tokens.secondaryText, opacity: 1 } },
        },
      },
      MuiTableCell: {
        styleOverrides: { root: { borderBottomColor: tokens.borderSubtle } },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&.Mui-selected': { backgroundColor: tokens.primarySoft },
            '&.Mui-selected:hover': { backgroundColor: tokens.primarySoftStrong },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { backgroundColor: tokens.mainText, color: tokens.surface } },
      },
      MuiBackdrop: {
        styleOverrides: { root: { backgroundColor: tokens.overlay } },
      },
      MuiPaper: {
        styleOverrides: { root: { backgroundColor: tokens.surface, color: tokens.mainText } },
      },
    },
  });
}
