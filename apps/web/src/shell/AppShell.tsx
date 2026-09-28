import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useTheme } from '@mui/material/styles';
import SvgIcon from '@mui/material/SvgIcon';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useSession } from '../api/session';
import { useLocale } from '../locale';
import { BrandMark } from './BrandMark';
import { NotificationBell } from './NotificationBell';
import { SearchBox } from './SearchBox';
import { breadcrumbFor, visibleGroups } from './navigation';

const DRAWER_WIDTH = 268;

/**
 * The authenticated application shell (THEME-011, THEME-012).
 *
 * The drawer is anchored at `left`, which MUI mirrors to the right in an RTL theme — so navigation
 * always sits at the **inline start** and the same code serves both directions. Everything else uses
 * logical properties for the same reason.
 *
 * Navigation is filtered by permission. That filter is presentation only; the server enforces every
 * permission again (ADR-0006), and the E2E suite proves it by calling a hidden route directly.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { otherLocale, setLocale, t, td } = useLocale();
  const { session, canAny, signOut } = useSession();
  const theme = useTheme();
  const location = useLocation();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);

  const groups = visibleGroups(canAny);
  const trail = breadcrumbFor(location.pathname);

  const navigation = (
    <Box component="nav" aria-label={t('shell.navigation')} id="app-navigation">
      <Toolbar />
      {/* On a phone the top bar has no room for search; it opens with the navigation instead. */}
      {isDesktop ? null : (
        <Box sx={{ paddingInline: 2, paddingBlockEnd: 1 }}>
          <SearchBox />
        </Box>
      )}
      {groups.map((group, index) => (
        <List
          key={group.labelKey}
          dense
          subheader={
            index === 0 ? undefined : (
              <ListSubheader
                disableSticky
                sx={{ bgcolor: 'transparent', fontWeight: 700, color: 'text.secondary' }}
              >
                {td(group.labelKey)}
              </ListSubheader>
            )
          }
        >
          {group.items.map((item) => {
            const selected =
              item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path);
            return (
              <ListItemButton
                key={item.path}
                component={Link}
                to={item.path}
                selected={selected}
                {...(selected ? { 'aria-current': 'page' as const } : {})}
                onClick={() => setMobileOpen(false)}
              >
                <ListItemText primary={td(item.labelKey)} />
              </ListItemButton>
            );
          })}
        </List>
      ))}
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
        <Toolbar sx={{ gap: 1.5 }}>
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
          <BrandMark variant="shell" />
          <Box sx={{ flexGrow: 1 }} />
          {isDesktop ? <SearchBox /> : null}

          <NotificationBell />

          {/* A deployment offering one language shows no switch at all (ADR-0027). */}
          {otherLocale ? (
            <Button variant="outlined" lang={otherLocale} onClick={() => setLocale(otherLocale)}>
              {t('shell.switchLanguage')}
            </Button>
          ) : null}

          <Button
            aria-label={t('shell.userMenu')}
            aria-haspopup="menu"
            aria-expanded={Boolean(userMenuAnchor)}
            onClick={(event) => setUserMenuAnchor(event.currentTarget)}
            sx={{ color: 'text.primary', fontWeight: 600 }}
          >
            {session?.account.displayName ?? ''}
          </Button>
          <Menu
            anchorEl={userMenuAnchor}
            open={Boolean(userMenuAnchor)}
            onClose={() => setUserMenuAnchor(null)}
          >
            <MenuItem disabled sx={{ opacity: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary" component="p">
                  {t('shell.signedInAs')}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {session?.account.displayName}
                </Typography>
              </Box>
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                setUserMenuAnchor(null);
                void signOut();
              }}
            >
              {t('shell.signOut')}
            </MenuItem>
          </Menu>
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
        sx={{
          flexGrow: 1,
          minWidth: 0,
          paddingInline: { xs: 2, md: 4 },
          paddingBlock: 3,
        }}
      >
        <Toolbar />
        <Breadcrumbs aria-label={t('shell.breadcrumb')} sx={{ marginBlockEnd: 2 }}>
          {trail.map((item, index) =>
            index === trail.length - 1 ? (
              <Typography key={item.path} color="text.primary" sx={{ fontWeight: 600 }}>
                {td(item.labelKey)}
              </Typography>
            ) : (
              <Box
                key={item.path}
                component={Link}
                to={item.path}
                sx={{ color: 'primary.main', textDecoration: 'underline' }}
              >
                {td(item.labelKey)}
              </Box>
            ),
          )}
        </Breadcrumbs>
        {children}
      </Box>
    </Box>
  );
}
