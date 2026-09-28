import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Icon, elevation, layout, tokens, visuallyHidden } from '@alola/ui';
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Languages,
  LogOut,
  Menu as MenuGlyph,
  PanelLeftClose,
  PanelLeftOpen,
} from '@alola/ui/icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation } from 'react-router';
import { useSession } from '../api/session';
import { initialsOf } from '../branding';
import { useLocale } from '../locale';
import { PeopleProvider, usePerson } from '../people';
import { BrandMark } from './BrandMark';
import { BreadcrumbProvider, useBreadcrumbTailValue } from './breadcrumbs';
import { NotificationBell } from './NotificationBell';
import { SearchBox } from './SearchBox';
import { breadcrumbFor, isActive, visibleGroups, type NavGroup } from './navigation';

/**
 * The authenticated application shell (THEME-011, THEME-012).
 *
 * Layout: a sidebar at the **inline start** (right in Arabic, left in English — the same flex row,
 * mirrored by direction rather than by a second layout), and a column holding a sticky top bar and
 * the page. The page is the one scroll area; the sidebar scrolls on its own only when its list is
 * taller than the window, with a thin scrollbar that stays out of the way.
 *
 * Navigation is filtered by permission. That filter is presentation only; the server enforces every
 * permission again (ADR-0006), and the E2E suite proves it by calling a hidden route directly.
 *
 * Two preferences are remembered in this browser only — whether the sidebar is collapsed to icons,
 * and which groups are folded. Both are conveniences: losing them (a private window, cleared storage)
 * changes nothing but the layout.
 */
const STORAGE_KEY = 'alola.shell.v1';

interface ShellPreferences {
  collapsed: boolean;
  foldedGroups: string[];
}

function readPreferences(): ShellPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { collapsed: false, foldedGroups: [] };
    const parsed = JSON.parse(raw) as Partial<ShellPreferences>;
    return {
      collapsed: parsed.collapsed === true,
      foldedGroups: Array.isArray(parsed.foldedGroups)
        ? parsed.foldedGroups.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch {
    return { collapsed: false, foldedGroups: [] };
  }
}

function writePreferences(preferences: ShellPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage unavailable: the preference simply is not remembered.
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <PeopleProvider>
      <BreadcrumbProvider>
        <ShellLayout>{children}</ShellLayout>
      </BreadcrumbProvider>
    </PeopleProvider>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [preferences, setPreferences] = useState<ShellPreferences>(readPreferences);

  const updatePreferences = useCallback((change: Partial<ShellPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change };
      writePreferences(next);
      return next;
    });
  }, []);

  const collapsed = isDesktop && preferences.collapsed;
  const sidebarWidth = collapsed ? layout.sidebarCollapsedWidthPx : layout.sidebarWidthPx;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href="#main"
        sx={{
          position: 'absolute',
          insetInlineStart: 8,
          insetBlockStart: -64,
          zIndex: theme.zIndex.tooltip,
          paddingInline: 2,
          paddingBlock: 1,
          bgcolor: 'background.paper',
          color: 'primary.main',
          borderRadius: 1,
          boxShadow: 3,
          '&:focus': { insetBlockStart: 8 },
        }}
      >
        {t('shell.skipToContent')}
      </Box>

      {isDesktop ? (
        <Box
          component="aside"
          sx={{
            position: 'sticky',
            insetBlockStart: 0,
            blockSize: '100vh',
            inlineSize: sidebarWidth,
            flexShrink: 0,
            bgcolor: 'background.paper',
            borderInlineEnd: 1,
            borderColor: tokens.borderSoft,
            transition: theme.transitions.create('inline-size', {
              duration: theme.transitions.duration.shorter,
            }),
            zIndex: theme.zIndex.appBar + 1,
          }}
        >
          <Sidebar
            collapsed={collapsed}
            foldedGroups={preferences.foldedGroups}
            onFoldedGroupsChange={(foldedGroups) => updatePreferences({ foldedGroups })}
            onToggleCollapsed={() => updatePreferences({ collapsed: !preferences.collapsed })}
          />
        </Box>
      ) : (
        <Drawer
          variant="temporary"
          anchor="left"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: false }}
          slotProps={{
            paper: {
              sx: { inlineSize: 'min(85vw, 300px)', boxSizing: 'border-box' },
            },
          }}
        >
          <Sidebar
            collapsed={false}
            mobile
            foldedGroups={preferences.foldedGroups}
            onFoldedGroupsChange={(foldedGroups) => updatePreferences({ foldedGroups })}
            onNavigate={() => setMobileOpen(false)}
          />
        </Drawer>
      )}

      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar isDesktop={isDesktop} onOpenNavigation={() => setMobileOpen(true)} />
        <Box
          component="main"
          id="main"
          tabIndex={-1}
          sx={{
            flexGrow: 1,
            minWidth: 0,
            inlineSize: '100%',
            maxInlineSize: layout.contentMaxWidthPx,
            marginInline: 'auto',
            paddingInline: layout.pagePadding,
            paddingBlockStart: { xs: 2, md: 2.5 },
            paddingBlockEnd: 6,
            '&:focus': { outline: 'none' },
          }}
        >
          <Trail />
          {children}
        </Box>
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------------- sidebar */

function Sidebar({
  collapsed,
  mobile = false,
  foldedGroups,
  onFoldedGroupsChange,
  onToggleCollapsed,
  onNavigate,
}: {
  collapsed: boolean;
  mobile?: boolean;
  foldedGroups: string[];
  onFoldedGroupsChange: (folded: string[]) => void;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useLocale();
  const { canAny } = useSession();
  const groups = visibleGroups(canAny);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', blockSize: '100%', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          minBlockSize: layout.topBarHeightPx + 8,
          paddingInline: collapsed ? 1 : 2.25,
          paddingBlock: 1.5,
          borderBlockEnd: 1,
          borderColor: tokens.borderSoft,
        }}
      >
        <BrandMark variant={collapsed ? 'compact' : 'sidebar'} />
      </Box>

      {mobile ? (
        <Box sx={{ paddingInline: 2, paddingBlockStart: 2 }}>
          <SearchBox />
        </Box>
      ) : null}

      <Box
        component="nav"
        aria-label={t('shell.navigation')}
        id="app-navigation"
        sx={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingInline: collapsed ? 1 : 1.5,
          paddingBlock: 1.5,
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.borderSubtle} transparent`,
        }}
      >
        {groups.map((group, index) => (
          <NavSection
            key={group.id}
            group={group}
            first={index === 0}
            collapsed={collapsed}
            folded={foldedGroups.includes(group.id)}
            onToggleFold={() =>
              onFoldedGroupsChange(
                foldedGroups.includes(group.id)
                  ? foldedGroups.filter((id) => id !== group.id)
                  : [...foldedGroups, group.id],
              )
            }
            {...(onNavigate ? { onNavigate } : {})}
          />
        ))}
      </Box>

      {onToggleCollapsed ? (
        <Box
          sx={{
            borderBlockStart: 1,
            borderColor: tokens.borderSoft,
            padding: 1,
            display: 'flex',
            justifyContent: collapsed ? 'center' : 'flex-end',
          }}
        >
          <Tooltip
            title={collapsed ? t('shell.expandNavigation') : t('shell.collapseNavigation')}
            placement="top"
          >
            <IconButton
              onClick={onToggleCollapsed}
              aria-label={collapsed ? t('shell.expandNavigation') : t('shell.collapseNavigation')}
              aria-pressed={collapsed}
            >
              <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} size={20} mirrorInRtl />
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}
    </Box>
  );
}

function NavSection({
  group,
  first,
  collapsed,
  folded,
  onToggleFold,
  onNavigate,
}: {
  group: NavGroup;
  first: boolean;
  collapsed: boolean;
  folded: boolean;
  onToggleFold: () => void;
  onNavigate?: () => void;
}) {
  const { td, t } = useLocale();
  const location = useLocation();
  const theme = useTheme();
  const containsActive = group.items.some((item) => isActive(item, location.pathname));
  // The group holding the current screen is never folded away: the person must see where they are.
  const open = collapsed || !folded || containsActive;
  const listId = `nav-group-${group.id}`;
  const label = td(group.labelKey);
  const tooltipPlacement = theme.direction === 'rtl' ? 'left' : 'right';

  return (
    <Box sx={{ marginBlockStart: first ? 0 : collapsed ? 1 : 1.5 }}>
      {collapsed ? (
        first ? null : (
          <Divider sx={{ marginBlockEnd: 1, marginInline: 1 }} />
        )
      ) : (
        <ButtonBase
          onClick={onToggleFold}
          aria-expanded={open}
          aria-controls={listId}
          aria-label={t('shell.toggleGroup', { group: label })}
          disabled={containsActive}
          sx={{
            inlineSize: '100%',
            justifyContent: 'space-between',
            paddingInline: 1.25,
            paddingBlock: 0.75,
            borderRadius: 1.5,
            color: 'text.secondary',
            '&:hover': { color: 'text.primary', bgcolor: tokens.neutralSoft },
            '&.Mui-disabled': { color: 'text.secondary' },
          }}
        >
          <Typography
            component="span"
            sx={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: 0.2 }}
            aria-hidden
          >
            {label}
          </Typography>
          {containsActive ? null : (
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                transition: theme.transitions.create('transform'),
                transform: open ? 'none' : 'rotate(-90deg)',
                '[dir="rtl"] &': { transform: open ? 'none' : 'rotate(90deg)' },
              }}
            >
              <Icon icon={ChevronDown} size={16} />
            </Box>
          )}
        </ButtonBase>
      )}
      <Collapse in={open} timeout="auto">
        <List
          id={listId}
          dense
          disablePadding
          aria-label={label}
          sx={{ display: 'grid', gap: 0.25, marginBlockStart: collapsed ? 0 : 0.5 }}
        >
          {group.items.map((item) => {
            const selected = isActive(item, location.pathname);
            const name = td(item.labelKey);
            const button = (
              <ListItemButton
                key={item.path}
                component={RouterLink}
                to={item.path}
                selected={selected}
                {...(selected ? { 'aria-current': 'page' as const } : {})}
                {...(collapsed ? { 'aria-label': name } : {})}
                onClick={onNavigate}
                sx={{
                  minBlockSize: 40,
                  paddingInline: collapsed ? 0 : 1.25,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  color: selected ? 'text.primary' : 'text.secondary',
                  '&:hover': { color: 'text.primary' },
                  '&.Mui-selected': {
                    fontWeight: 600,
                    '& [data-icon]': { color: 'primary.main' },
                  },
                }}
              >
                <ListItemIcon
                  sx={{ minWidth: 0, marginInlineEnd: collapsed ? 0 : 1.5, color: 'inherit' }}
                >
                  <Icon icon={item.icon} size={20} />
                </ListItemIcon>
                {collapsed ? null : (
                  <ListItemText
                    primary={name}
                    slotProps={{
                      primary: {
                        sx: {
                          fontSize: '0.875rem',
                          fontWeight: selected ? 600 : 500,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        },
                      },
                    }}
                  />
                )}
              </ListItemButton>
            );
            return collapsed ? (
              <Tooltip key={item.path} title={name} placement={tooltipPlacement}>
                {button}
              </Tooltip>
            ) : (
              button
            );
          })}
        </List>
      </Collapse>
    </Box>
  );
}

/* ------------------------------------------------------------------- top bar */

function TopBar({
  isDesktop,
  onOpenNavigation,
}: {
  isDesktop: boolean;
  onOpenNavigation: () => void;
}) {
  const { otherLocale, setLocale, t } = useLocale();
  const theme = useTheme();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        insetBlockStart: 0,
        zIndex: theme.zIndex.appBar,
        blockSize: layout.topBarHeightPx,
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 0.5, sm: 1 },
        paddingInline: { xs: 1, sm: 2, lg: 3 },
        bgcolor: 'background.paper',
        borderBlockEnd: 1,
        borderColor: tokens.borderSoft,
        boxShadow: scrolled ? elevation.raised : elevation.none,
      }}
    >
      {isDesktop ? null : (
        <IconButton
          aria-label={t('shell.openNavigation')}
          aria-controls="app-navigation"
          onClick={onOpenNavigation}
        >
          <Icon icon={MenuGlyph} size={22} />
        </IconButton>
      )}
      {isDesktop ? (
        <Box sx={{ flex: '0 1 420px', minWidth: 200 }}>
          <SearchBox />
        </Box>
      ) : null}
      <Box sx={{ flexGrow: 1 }} />

      <NotificationBell />

      {/* A deployment offering one language shows no switch at all (ADR-0027). */}
      {otherLocale ? (
        isDesktop ? (
          <Button
            color="inherit"
            variant="text"
            lang={otherLocale}
            onClick={() => setLocale(otherLocale)}
            startIcon={<Icon icon={Languages} size={18} />}
            sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
          >
            {t('shell.switchLanguage')}
          </Button>
        ) : (
          <Tooltip title={t('shell.switchLanguage')}>
            <IconButton
              lang={otherLocale}
              aria-label={t('shell.switchLanguage')}
              onClick={() => setLocale(otherLocale)}
            >
              <Icon icon={Languages} size={20} />
            </IconButton>
          </Tooltip>
        )
      ) : null}

      <Divider orientation="vertical" flexItem sx={{ marginBlock: 1.5, marginInline: 0.5 }} />
      <UserMenu isDesktop={isDesktop} />
    </Box>
  );
}

function UserMenu({ isDesktop }: { isDesktop: boolean }) {
  const { t, locale } = useLocale();
  const { session, signOut, can } = useSession();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const person = usePerson(session?.account.accountId);
  const name = session?.account.displayName ?? '';
  const jobTitle = person.kind === 'known' ? person.person.jobTitle?.[locale] : undefined;

  return (
    <>
      <ButtonBase
        aria-label={`${t('shell.userMenu')} — ${name}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          paddingInline: 1,
          paddingBlock: 0.5,
          borderRadius: 2,
          minBlockSize: 44,
          textAlign: 'start',
          '&:hover': { bgcolor: tokens.neutralSoft },
        }}
      >
        <Avatar aria-hidden sx={{ inlineSize: 34, blockSize: 34 }}>
          {initialsOf(name)}
        </Avatar>
        {isDesktop ? (
          <Box sx={{ minWidth: 0, maxInlineSize: 180 }} aria-hidden>
            <Typography
              component="span"
              sx={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: 600,
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </Typography>
            {jobTitle ? (
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{
                  display: 'block',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {jobTitle}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { minInlineSize: 260 } } }}
      >
        <Box sx={{ paddingInline: 2, paddingBlock: 1.25 }}>
          <Typography variant="caption" color="text.secondary" component="p">
            {t('shell.signedInAs')}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {name}
          </Typography>
          {jobTitle ? (
            <Typography variant="caption" color="text.secondary" component="p">
              {jobTitle}
            </Typography>
          ) : null}
          {session ? (
            <Typography variant="caption" color="text.secondary" component="p">
              <bdi dir="ltr">{session.account.loginIdentifier}</bdi>
            </Typography>
          ) : null}
        </Box>
        <Divider />
        {can('company.profile.view') ? (
          <MenuItem component={RouterLink} to="/settings/company" onClick={() => setAnchor(null)}>
            <ListItemIcon sx={{ color: 'text.secondary' }}>
              <Icon icon={BadgeCheck} size={18} />
            </ListItemIcon>
            {t('nav.companyIdentity')}
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={() => {
            setAnchor(null);
            void signOut();
          }}
        >
          <ListItemIcon sx={{ color: 'text.secondary' }}>
            <Icon icon={LogOut} size={18} mirrorInRtl />
          </ListItemIcon>
          {t('shell.signOut')}
        </MenuItem>
      </Menu>
    </>
  );
}

/* --------------------------------------------------------------- breadcrumbs */

function Trail() {
  const { t, td } = useLocale();
  const location = useLocation();
  const tail = useBreadcrumbTailValue();
  const trail = breadcrumbFor(location.pathname);
  const crumbs = [
    ...trail.map((item) => ({ key: item.path, label: td(item.labelKey), to: item.path })),
    ...(tail ? [{ key: 'tail', label: tail, to: undefined }] : []),
  ];
  // The dashboard is its own home: a trail of one says nothing the page title does not.
  if (crumbs.length < 2) return <Box component="span" sx={visuallyHidden} />;

  return (
    <Breadcrumbs
      aria-label={t('shell.breadcrumb')}
      separator={<Icon icon={ChevronRight} size={14} mirrorInRtl />}
      sx={{ marginBlockEnd: 1.5, color: 'text.secondary' }}
    >
      {crumbs.map((crumb, index) =>
        index === crumbs.length - 1 || !crumb.to ? (
          <Typography
            key={crumb.key}
            component="span"
            aria-current="page"
            sx={{ fontSize: '0.8125rem', fontWeight: 600, color: 'text.primary' }}
          >
            <bdi>{crumb.label}</bdi>
          </Typography>
        ) : (
          <Link
            key={crumb.key}
            component={RouterLink}
            to={crumb.to}
            underline="hover"
            sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500 }}
          >
            {crumb.label}
          </Link>
        ),
      )}
    </Breadcrumbs>
  );
}
