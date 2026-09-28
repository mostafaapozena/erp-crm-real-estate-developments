import { createTheme, type Theme } from '@mui/material/styles';
import { localeSettings, type Locale } from '@alola/i18n';
import type { Palette } from './brand';
import { layout } from './layout';
import { elevation, focusRingWidthPx, tokens } from './tokens';

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
 *
 * **Type scale** (ADR-0030). Only the self-hosted weights 400, 600 and 700 exist (I18N-007):
 *
 * | Role              | Variant       | Size       | Weight |
 * |-------------------|---------------|------------|--------|
 * | Page title        | h1            | 1.625 rem  | 700    |
 * | Section title     | h2            | 1.125 rem  | 600    |
 * | Card title        | h3 / subtitle1| 1 rem      | 600    |
 * | Body              | body1         | 0.9375 rem | 400    |
 * | Supporting / cell | body2         | 0.875 rem  | 400    |
 * | Table header      | (TableCell)   | 0.8125 rem | 600    |
 * | Label / caption   | caption       | 0.75 rem   | 400    |
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
      divider: palette.borderSoft,
      common: { black: palette.mainText, white: palette.surface },
      action: {
        active: palette.secondaryText,
        hover: palette.neutralSoft,
        selected: palette.primarySoft,
        focus: palette.primarySoft,
        disabled: palette.disabled,
        disabledBackground: palette.borderSoft,
      },
    },
    typography: {
      fontFamily: settings.fontFamily,
      fontWeightLight: 400,
      fontWeightRegular: 400,
      fontWeightMedium: 600,
      fontWeightBold: 700,
      h1: { fontSize: '1.625rem', fontWeight: 700, lineHeight: 1.3 },
      h2: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
      h3: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.45 },
      h4: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.45 },
      h5: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.5 },
      h6: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.5 },
      subtitle1: { fontSize: '1rem', fontWeight: 600, lineHeight: settings.lineHeight },
      subtitle2: { fontSize: '0.875rem', fontWeight: 600, lineHeight: settings.lineHeight },
      body1: { fontSize: '0.9375rem', lineHeight: settings.lineHeight },
      body2: { fontSize: '0.875rem', lineHeight: settings.lineHeight },
      caption: { fontSize: '0.75rem', lineHeight: 1.5 },
      button: { textTransform: 'none', fontWeight: 600, fontSize: '0.875rem' },
    },
    shape: { borderRadius: layout.radius.md },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { WebkitTextSizeAdjust: '100%' },
          body: {
            backgroundColor: palette.pageBackground,
            color: palette.mainText,
            // Mid-weight Arabic glyphs render heavier than Latin ones at the same weight.
            WebkitFontSmoothing: 'antialiased',
          },
          ':focus-visible': focusOutline,
          // Respect a request for less motion: transitions and animations become instant.
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important',
              scrollBehavior: 'auto !important',
            },
          },
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
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: layout.radius.md,
            minHeight: 36,
            paddingInline: 16,
            variants: [
              { props: { size: 'large' }, style: { minHeight: layout.controlHeightPx + 4 } },
              { props: { size: 'small' }, style: { minHeight: 32, paddingInline: 12 } },
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
                props: { variant: 'outlined', color: 'inherit' },
                style: {
                  borderColor: palette.borderStrong,
                  color: palette.mainText,
                  '&:hover': { backgroundColor: palette.neutralSoft },
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
            color: palette.secondaryText,
            borderRadius: layout.radius.md,
            '&:hover': { backgroundColor: palette.neutralSoft, color: palette.mainText },
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
            borderRadius: layout.radius.md,
            '&:hover': { backgroundColor: palette.neutralSoft },
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
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiOutlinedInput: {
        styleOverrides: {
          // THEME-007: a control boundary uses borderStrong, never borderSubtle.
          notchedOutline: { borderColor: palette.borderStrong },
          root: {
            backgroundColor: palette.surface,
            borderRadius: layout.radius.md,
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
      MuiInputLabel: {
        styleOverrides: { root: { color: palette.secondaryText } },
      },
      MuiFormHelperText: {
        styleOverrides: { root: { marginInline: 2, color: palette.secondaryText } },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottomColor: palette.borderSoft,
            paddingBlock: 10,
            fontSize: '0.875rem',
            verticalAlign: 'middle',
          },
          head: {
            backgroundColor: palette.neutralSoft,
            color: palette.secondaryText,
            fontWeight: 600,
            fontSize: '0.8125rem',
            whiteSpace: 'nowrap',
            paddingBlock: 9,
          },
          stickyHeader: { backgroundColor: palette.neutralSoft },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&:last-of-type > td': { borderBottom: 0 },
            '&.MuiTableRow-hover:hover': { backgroundColor: palette.neutralSoft },
            '&.Mui-selected': { backgroundColor: palette.primarySoft },
            '&.Mui-selected:hover': { backgroundColor: palette.primarySoftStrong },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 44, borderBottom: `1px solid ${palette.borderSoft}` },
          indicator: { height: 3, borderRadius: '3px 3px 0 0' },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 44,
            textTransform: 'none',
            fontWeight: 600,
            color: palette.secondaryText,
            '&.Mui-selected': { color: palette.mainText },
            '&:hover': { color: palette.mainText },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, borderRadius: 999 },
          outlined: { borderColor: palette.borderSubtle },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: {
          tooltip: {
            backgroundColor: palette.mainText,
            color: palette.surface,
            fontSize: '0.75rem',
            fontWeight: 600,
          },
          arrow: { color: palette.mainText },
        },
      },
      MuiBackdrop: {
        styleOverrides: { root: { backgroundColor: palette.overlay } },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: palette.surface,
            color: palette.mainText,
            backgroundImage: 'none',
          },
          outlined: { borderColor: palette.borderSoft, boxShadow: elevation.card },
          rounded: { borderRadius: layout.radius.lg },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            boxShadow: elevation.overlay,
            border: `1px solid ${palette.borderSoft}`,
            borderRadius: layout.radius.md,
          },
        },
      },
      MuiPopover: {
        styleOverrides: { paper: { boxShadow: elevation.overlay } },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: { boxShadow: elevation.overlay, border: `1px solid ${palette.borderSoft}` },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            minHeight: 40,
            fontSize: '0.875rem',
            '&:hover': { backgroundColor: palette.neutralSoft },
            '&.Mui-selected': { backgroundColor: palette.primarySoft },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: layout.radius.lg, boxShadow: elevation.modal },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontSize: '1.125rem',
            fontWeight: 700,
            paddingBlock: 16,
            borderBottom: `1px solid ${palette.borderSoft}`,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: { root: { paddingBlockStart: '20px !important' } },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            paddingInline: 24,
            paddingBlock: 16,
            gap: 8,
            borderTop: `1px solid ${palette.borderSoft}`,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: layout.radius.md, alignItems: 'flex-start' },
          message: { fontSize: '0.875rem' },
        },
      },
      MuiBreadcrumbs: {
        styleOverrides: { li: { fontSize: '0.8125rem' }, separator: { marginInline: 4 } },
      },
      MuiDrawer: {
        styleOverrides: { paper: { borderColor: palette.borderSoft } },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: palette.borderSoft } },
      },
      MuiSkeleton: {
        styleOverrides: { root: { backgroundColor: palette.neutralSoft } },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            backgroundColor: palette.primarySoftStrong,
            color: palette.mainText,
            fontWeight: 700,
            fontSize: '0.875rem',
          },
        },
      },
    },
  });
}
