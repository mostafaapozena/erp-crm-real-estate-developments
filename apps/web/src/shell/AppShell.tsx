import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useTheme } from '@mui/material/styles';
import SvgIcon from '@mui/material/SvgIcon';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useState, type ReactNode } from 'react';
import { useLocale } from '../locale';
import { DevLogoPlaceholder } from './DevLogoPlaceholder';

const DRAWER_WIDTH = 264;

/**
 * Application shell (THEME-011, THEME-012): skip link, top bar, and responsive navigation — a
 * permanent drawer on wide screens and a modal drawer behind a menu button on narrow ones. The drawer
 * is anchored at the inline **start**: MUI mirrors `left` to the right side when the theme is RTL.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { locale, setLocale, t } = useLocale();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const otherLocale = locale === 'ar' ? 'en' : 'ar';

  const navigation = (
    <Box component="nav" aria-label={t('shell.navigation')} id="app-navigation">
      <Toolbar />
      <List>
        <ListItemButton selected aria-current="page" onClick={() => setMobileOpen(false)}>
          <ListItemText primary={t('nav.foundation')} />
        </ListItemButton>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href="#main"
        sx={{
          position: 'absolute',
          insetInlineStart: 8,
          insetBlockStart: -48,
          zIndex: theme.zIndex.tooltip,
          paddingInline: 2,
          paddingBlock: 1,
          bgcolor: 'background.paper',
          color: 'primary.main',
          borderRadius: 1,
          '&:focus': { insetBlockStart: 8 },
        }}
      >
        {t('shell.skipToContent')}
      </Box>

      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderBlockEnd: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          {isDesktop ? null : (
            <IconButton
              edge="start"
              aria-label={t('shell.openNavigation')}
              aria-controls="app-navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <SvgIcon aria-hidden>
                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
              </SvgIcon>
            </IconButton>
          )}
          <Typography component="p" variant="h6" noWrap>
            {t('app.title')}
          </Typography>
          {import.meta.env.PROD ? null : <DevLogoPlaceholder />}
          <Box sx={{ flexGrow: 1 }} />
          {/* The label is the target language's own name, marked with its language for screen readers. */}
          <Button variant="outlined" lang={otherLocale} onClick={() => setLocale(otherLocale)}>
            {t('shell.switchLanguage')}
          </Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isDesktop ? 'permanent' : 'temporary'}
        anchor="left"
        open={isDesktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        slotProps={{ paper: { sx: { width: DRAWER_WIDTH, boxSizing: 'border-box' } } }}
        sx={{ width: isDesktop ? DRAWER_WIDTH : undefined, flexShrink: 0 }}
      >
        {navigation}
      </Drawer>

      <Box
        component="main"
        id="main"
        tabIndex={-1}
        sx={{ flexGrow: 1, minWidth: 0, paddingInline: { xs: 2, md: 4 }, paddingBlock: 3 }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
