import type { ExportKind, ExportResult, Permission } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { apiRequest } from '../api/client';
import { useSession } from '../api/session';
import { useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useLocale } from '../locale';

/**
 * "Export as CSV" (CORE-IMPORT-003).
 *
 * Shown only to someone holding the export permission — a courtesy; the server checks it again,
 * applies the data scope, leaves out restricted columns and records the export. The file arrives
 * through a link that expires within minutes, opened at once rather than kept.
 */
export function ExportButton({ kind, permission }: { kind: ExportKind; permission: Permission }) {
  const { t } = useLocale();
  const { can } = useSession();
  const errorMessage = useErrorMessage();
  const run = useMutation<void, ExportResult>(() =>
    apiRequest<ExportResult>('/api/v1/exports', { method: 'POST', body: { kind } }),
  );
  if (!can(permission)) return null;
  return (
    <Stack spacing={1}>
      <Button
        variant="outlined"
        disabled={run.pending}
        onClick={() => {
          void run.run().then(
            (result) => {
              window.location.assign(result.url);
            },
            () => undefined,
          );
        }}
      >
        {t('exports.csv')}
      </Button>
      {run.error ? <Alert severity="error">{errorMessage(run.error)}</Alert> : null}
    </Stack>
  );
}
