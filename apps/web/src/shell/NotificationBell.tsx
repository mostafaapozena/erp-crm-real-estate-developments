import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { useApi } from '../api/useApi';
import { useLocale } from '../locale';

/**
 * The shell's notification indicator (CORE-NOTIFY-001).
 *
 * It counts the signed-in person's unread in-app notices and links to the inbox. The count is fetched
 * again on every navigation and whenever the inbox changes one, so it does not need a socket to stay
 * roughly current; a missing count renders no badge rather than a wrong number.
 */
export function NotificationBell() {
  const { t } = useLocale();
  const location = useLocation();
  const count = useApi<{ unread: number }>('/api/v1/notifications/unread-count');
  const { reload } = count;

  useEffect(() => {
    reload();
  }, [location.pathname, reload]);

  useEffect(() => {
    window.addEventListener('notifications-changed', reload);
    return () => window.removeEventListener('notifications-changed', reload);
  }, [reload]);

  const unread = count.state.kind === 'ready' ? count.state.data.unread : 0;
  const label =
    unread > 0
      ? `${t('shell.notifications')} — ${t('notifications.unreadCount', { count: unread })}`
      : t('shell.notifications');

  return (
    <IconButton component={Link} to="/notifications" aria-label={label}>
      {/* No content at all when nothing is unread, so no hidden "0" sits in the document. */}
      <Badge color="primary" badgeContent={unread > 0 ? unread : undefined} max={99}>
        <SvgIcon aria-hidden>
          <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
        </SvgIcon>
      </Badge>
    </IconButton>
  );
}
