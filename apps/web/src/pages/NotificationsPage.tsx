import type { Notification } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { PageHeader, StateView } from '@alola/ui';
import { useState } from 'react';
import { apiRequest, query } from '../api/client';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { ErrorState, Verbatim } from './shared';

/**
 * The signed-in person's in-app notifications (CORE-NOTIFY-001).
 *
 * The server stores a type and its parameters, never prose, so each notice is read in the reader's
 * current language (CORE-NOTIFY-003, I18N-008). Nobody needs a permission for their own inbox, and the
 * server narrows every query to the caller — this screen cannot show anyone else's.
 */
export default function NotificationsPage() {
  const { t, td } = useLocale();
  const format = useFormatters();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const inbox = useApi<{ items: Notification[]; unread: number }>(
    `/api/v1/notifications/inbox${query({ unreadOnly: unreadOnly ? 'true' : undefined, limit: 50 })}`,
  );

  const act = async (path: string) => {
    setBusy(true);
    try {
      await apiRequest(path, { method: 'POST' });
      // Tell the shell's badge to count again.
      window.dispatchEvent(new Event('notifications-changed'));
      inbox.reload();
    } finally {
      setBusy(false);
    }
  };

  const data = inbox.state.kind === 'ready' ? inbox.state.data : undefined;

  return (
    <Box>
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        actions={
          <Button
            variant="outlined"
            disabled={busy || !data || data.unread === 0}
            onClick={() => void act('/api/v1/notifications/read-all')}
          >
            {t('notifications.markAllRead')}
          </Button>
        }
        banner={
          data ? (
            <Typography variant="body2" color="text.secondary">
              {t('notifications.unreadCount', { count: data.unread })}
            </Typography>
          ) : undefined
        }
      />
      <FormControlLabel
        control={
          <Switch checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
        }
        label={t('notifications.unreadOnly')}
        sx={{ marginBlockEnd: 2 }}
      />
      {inbox.state.kind === 'loading' ? (
        <StateView kind="loading" title={t('states.loadingTitle')} />
      ) : inbox.state.kind === 'error' ? (
        <ErrorState error={inbox.state.error} onRetry={inbox.reload} />
      ) : inbox.state.data.items.length === 0 ? (
        <StateView kind="empty" title={t('notifications.empty')} />
      ) : (
        <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {inbox.state.data.items.map((item) => (
            <Paper
              key={item.notificationId}
              component="li"
              variant="outlined"
              sx={{
                padding: 2,
                // Unread is marked by a thicker inline-start edge and by the button — never by
                // colour alone (THEME-004).
                ...(item.read
                  ? {}
                  : { borderInlineStartWidth: 4, borderInlineStartColor: 'primary.main' }),
              }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    component="h2"
                    variant="subtitle1"
                    sx={{ fontWeight: item.read ? 400 : 700 }}
                  >
                    {td(`notificationTitle.${item.type}`, item.params)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {td(`notificationBody.${item.type}`, item.params)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="p">
                    <Verbatim>{format.dateTime(item.createdAt)}</Verbatim>
                  </Typography>
                </Box>
                {item.read ? null : (
                  <Box sx={{ flexShrink: 0 }}>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => void act(`/api/v1/notifications/${item.notificationId}/read`)}
                    >
                      {t('notifications.markRead')}
                    </Button>
                  </Box>
                )}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}
