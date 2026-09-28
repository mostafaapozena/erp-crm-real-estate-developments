import { REFERENCE_IMPORT_COLUMNS, type ImportBatch } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { PageHeader, StatusChip } from '@alola/ui';
import { useRef, useState } from 'react';
import { apiBlob, apiRequest, query, type ApiError } from '../api/client';
import { useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useLocale } from '../locale';
import { RequirePermission, Verbatim } from './shared';

/**
 * Reference-data import (CORE-IMPORT-001, CORE-IMPORT-002).
 *
 * Upload, read the preview and every issue, then commit — or discard. The commit button is disabled
 * while any issue remains, because the server refuses a partial import anyway; the screen says why
 * rather than letting the person discover it.
 */
export default function ImportsPage() {
  return (
    <RequirePermission permission="referenceData.manage">
      <ImportsScreen />
    </RequirePermission>
  );
}

function issueText(td: (key: string) => string, code: string): string {
  const key = `importIssue.${code}`;
  const text = td(key);
  return text === key ? code : text;
}

function ImportsScreen() {
  const { t, td } = useLocale();
  const errorMessage = useErrorMessage();
  const input = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<ImportBatch | undefined>();

  const describe = (error: ApiError) => {
    const code = error.issues?.[0]?.code;
    return code ? issueText(td, code) : errorMessage(error);
  };

  const upload = useMutation<File, ImportBatch>((file) =>
    apiRequest<ImportBatch>(
      `/api/v1/imports${query({ kind: 'referenceItems', fileName: file.name.slice(0, 200) })}`,
      { method: 'POST', file },
    ),
  );
  const decide = useMutation<'commit' | 'discard', ImportBatch>((action) =>
    apiRequest<ImportBatch>(`/api/v1/imports/${batch?.batchId ?? ''}/${action}`, {
      method: 'POST',
      body: { expectedVersion: batch?.version },
    }),
  );

  return (
    <Box>
      <PageHeader title={t('imports.title')} subtitle={t('imports.subtitle')} />
      <Stack spacing={3}>
        <Paper variant="outlined" sx={{ padding: 2 }}>
          <Stack spacing={1.5}>
            <Typography variant="body2">{t('imports.columnsHint')}</Typography>
            <Typography variant="body2" component="div">
              <Verbatim>
                {REFERENCE_IMPORT_COLUMNS.map((column) => column.name).join(', ')}
              </Verbatim>
            </Typography>
            <Box>
              <input
                ref={input}
                id="import-file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void upload.run(file).then(setBatch, () => undefined);
                }}
              />
              <Button
                variant="contained"
                disabled={upload.pending}
                onClick={() => input.current?.click()}
              >
                {t('imports.choose')}
              </Button>
            </Box>
            {upload.error ? <Alert severity="error">{describe(upload.error)}</Alert> : null}
          </Stack>
        </Paper>

        {batch ? (
          <Paper variant="outlined" sx={{ padding: 2 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography component="h2" variant="h6">
                  <bdi>{batch.fileName}</bdi>
                </Typography>
                <StatusChip
                  tone={
                    batch.state === 'committed'
                      ? 'success'
                      : batch.state === 'discarded'
                        ? 'neutral'
                        : batch.issueCount > 0
                          ? 'danger'
                          : 'info'
                  }
                  label={td(`importState.${batch.state}`)}
                />
              </Stack>
              <Typography variant="body2">
                {t('imports.summary', {
                  total: batch.totalRows,
                  valid: batch.validRows,
                  invalid: batch.invalidRows,
                })}
              </Typography>

              {batch.issueCount > 0 ? (
                <>
                  <Alert severity="warning">{t('imports.hasIssues')}</Alert>
                  <Table size="small" aria-label={t('imports.issues')}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('imports.row')}</TableCell>
                        <TableCell>{t('imports.column')}</TableCell>
                        <TableCell>{t('imports.problem')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {batch.issues.map((issue, index) => (
                        <TableRow
                          key={`${String(issue.row)}-${issue.column ?? ''}-${String(index)}`}
                        >
                          <TableCell>
                            <Verbatim>{String(issue.row)}</Verbatim>
                          </TableCell>
                          <TableCell>
                            <Verbatim>{issue.column ?? '—'}</Verbatim>
                          </TableCell>
                          <TableCell>{issueText(td, issue.code)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Box>
                    <Button
                      variant="outlined"
                      onClick={() => {
                        // A plain link would not carry the access token; fetch, then save.
                        void apiBlob(`/api/v1/imports/${batch.batchId}/issues.csv`).then(
                          (blob) => {
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = `import-issues-${batch.batchId}.csv`;
                            link.click();
                            URL.revokeObjectURL(url);
                          },
                          () => undefined,
                        );
                      }}
                    >
                      {t('imports.downloadIssues')}
                    </Button>
                  </Box>
                </>
              ) : null}

              {batch.preview.length > 0 ? (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" aria-label={t('imports.preview')}>
                    <TableHead>
                      <TableRow>
                        {Object.keys(batch.preview[0] ?? {}).map((column) => (
                          <TableCell key={column}>
                            <Verbatim>{column}</Verbatim>
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {batch.preview.map((row, index) => (
                        <TableRow key={String(index)}>
                          {Object.values(row).map((value, column) => (
                            <TableCell key={String(column)}>
                              <bdi>{value}</bdi>
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ) : null}

              {decide.error ? <Alert severity="error">{describe(decide.error)}</Alert> : null}
              {batch.state === 'previewed' ? (
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    disabled={decide.pending || batch.issueCount > 0}
                    onClick={() => void decide.run('commit').then(setBatch, () => undefined)}
                  >
                    {t('imports.commit')}
                  </Button>
                  <Button
                    disabled={decide.pending}
                    onClick={() => void decide.run('discard').then(setBatch, () => undefined)}
                  >
                    {t('imports.discard')}
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          </Paper>
        ) : null}
      </Stack>
    </Box>
  );
}
