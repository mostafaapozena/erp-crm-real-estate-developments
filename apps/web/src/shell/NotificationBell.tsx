import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import { Icon } from '@alola/ui';
import { Bell } from '@alola/ui/icons';
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
        <Icon icon={Bell} size={22} />
      </Badge>
    </IconButton>
  );
}
