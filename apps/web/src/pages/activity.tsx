import type { Activity } from '@alola/contracts';
import Box from '@mui/material/Box';
import { StateView } from '@alola/ui';
import {
  BadgeCheck,
  CalendarClock,
  CircleDot,
  FilePen,
  History,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from '@alola/ui/icons';
import type { AsyncState } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { Panel, SystemNote, Timeline, Transition, Verbatim } from './shared';

/** One glyph per kind of activity, so a timeline can be scanned by shape as well as by word. */
export const ACTIVITY_ICONS: Partial<Record<Activity['kind'], LucideIcon>> = {
  note: FilePen,
  call: Phone,
  whatsapp: MessageCircle,
  sms: MessageCircle,
  email: Mail,
  meeting: Users,
  siteVisit: MapPin,
  followUpScheduled: CalendarClock,
  stageChanged: TrendingUp,
  assignmentChanged: UserPlus,
  converted: BadgeCheck,
};

/**
 * A CRM timeline, newest first: a lead's, a customer's or an opportunity's (CRM-ACTIVITY-001).
 * A stage change is labelled from the pipeline it belongs to — an opportunity's stages are not a
 * lead's — and references the sales service wrote are translated on display, never rewritten.
 */
export function ActivityTimeline({
  activities,
  title,
}: {
  activities: AsyncState<{ items: Activity[] }>;
  title: string;
}) {
  const { t, td } = useLocale();
  const format = useFormatters();
  return (
    <Panel title={title} icon={History}>
      {activities.kind === 'loading' ? (
        <StateView variant="inline" kind="loading" title={t('states.loadingTitle')} />
      ) : activities.kind === 'error' ? (
        <StateView
          variant="inline"
          kind={activities.error.status === 403 ? 'forbidden' : 'error'}
          title={
            activities.error.status === 403 ? t('states.forbiddenTitle') : t('states.errorTitle')
          }
        />
      ) : (
        <Timeline
          emptyLabel={t('states.emptyDescription')}
          entries={activities.data.items.map((activity) => {
            const stages = activity.opportunityId ? 'opportunityStage' : 'leadStage';
            return {
              key: activity.activityId,
              icon: ACTIVITY_ICONS[activity.kind] ?? CircleDot,
              title: td(`activityKind.${activity.kind}`),
              when: format.dateTime(activity.occurredAt),
              body: (
                <>
                  {activity.fromStage && activity.toStage ? (
                    <Box>
                      <Transition
                        from={td(`${stages}.${activity.fromStage}`)}
                        to={td(`${stages}.${activity.toStage}`)}
                      />
                    </Box>
                  ) : null}
                  {activity.body ? (
                    <Box sx={{ color: 'text.primary' }}>
                      <SystemNote text={activity.body} />
                    </Box>
                  ) : null}
                  {activity.dueOn ? (
                    <Box>
                      {`${t('crm.activityDueOn')}: `}
                      <Verbatim>{format.date(activity.dueOn)}</Verbatim>
                    </Box>
                  ) : null}
                </>
              ),
            };
          })}
        />
      )}
    </Panel>
  );
}
