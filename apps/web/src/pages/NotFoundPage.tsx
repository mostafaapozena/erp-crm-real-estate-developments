import Button from '@mui/material/Button';
import { StateView } from '@alola/ui';
import { Link } from 'react-router';
import { useLocale } from '../locale';

/**
 * An address that does not exist.
 *
 * Deliberately the same wording as an empty result rather than a distinct "404" page: a person who
 * followed a stale link and a person whose record was moved out of their scope are in the same
 * position, and telling them apart would leak whether the record exists (SEC-030).
 */
export default function NotFoundPage() {
  const { t } = useLocale();
  return (
    <StateView
      kind="empty"
      title={t('states.emptyTitle')}
      description={t('states.emptyDescription')}
      action={
        <Button component={Link} to="/" variant="contained">
          {t('nav.dashboard')}
        </Button>
      }
    />
  );
}
