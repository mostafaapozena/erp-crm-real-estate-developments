import type {
  DownloadLink,
  IssuePreview,
  IssuedDocument,
  IssuedDocumentType,
  IssuedState,
  Locale,
} from '@alola/contracts';
import { SUPPORTED_LOCALES } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DataTable, Icon, StatusChip, type DataColumn, type StatusTone } from '@alola/ui';
import { CircleX, Download, FileText, Plus, ShieldCheck } from '@alola/ui/icons';
import { useMemo, useState } from 'react';
import { apiRequest, query } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { Panel, Verbatim, tableStatus, useTableLabels } from './shared';

export type IssuedSourceType = 'quotation' | 'reservation' | 'contract' | 'receipt' | 'customer';

const STATE_TONES: Record<IssuedState, StatusTone> = {
  issued: 'success',
  superseded: 'neutral',
  revoked: 'danger',
};

/** The path of the verification page on this origin, whatever origin the printed link names. */
function verificationPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return undefined;
  }
}

/**
 * The PDFs issued from one record, and the actions on them (CORE-DOC-003, CORE-DOC-005).
 *
 * Every control follows a permission the API enforces anyway (ADR-0006): the list needs
 * `document.view`, issuing `document.generate`, downloading `document.download`, revoking the
 * administrative `document.revoke`. Without `document.view` and `document.generate` the panel is not
 * shown at all. The server additionally requires the permission that reads the source record and
 * hides restricted-content files from anyone who may not see their fields; the panel never assumes
 * it knows better than the list it receives.
 *
 * Before issuing, the person sees the reference, the version that will be issued and every warning
 * the server names — draft, not the final contract, identity missing, expired — so a document is
 * never issued without its caveats having been on screen.
 */
export function IssuedDocumentsPanel({
  sourceType,
  sourceId,
  types,
  title,
  description,
}: {
  sourceType: IssuedSourceType;
  sourceId: string;
  types: readonly IssuedDocumentType[];
  title?: string;
  description?: string;
}) {
  const { can } = useSession();
  const { t, td } = useLocale();
  const format = useFormatters();
  const labels = useTableLabels();
  const errorMessage = useErrorMessage();
  const mayView = can('document.view');
  const mayGenerate = can('document.generate');
  const mayDownload = can('document.download');
  const mayRevoke = can('document.revoke');

  const list = useApi<{ items: IssuedDocument[] }>(
    mayView ? `/api/v1/issued-documents${query({ sourceType, sourceId })}` : undefined,
  );
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState<IssuedDocument | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const download = useMutation((row: IssuedDocument) =>
    apiRequest<DownloadLink>(`/api/v1/documents/${row.documentId}/download`, {
      method: 'POST',
      body: { version: row.documentVersion, purpose: 'download' },
    }),
  );

  const rows = useMemo(
    () =>
      list.state.kind === 'ready'
        ? list.state.data.items.filter((item) => types.includes(item.type))
        : [],
    [list.state, types],
  );

  if (!mayView && !mayGenerate) return null;

  const typeLabel = (type: IssuedDocumentType) => td(`issuedDocumentType.${type}`);
  const describe = (row: IssuedDocument) => ({
    type: typeLabel(row.type),
    version: format.number(row.version),
  });

  async function openDownload(row: IssuedDocument) {
    try {
      const link = await download.run(row);
      // The file is served as an attachment, so navigating to it downloads without leaving the page.
      window.location.assign(link.url);
    } catch {
      // The error is shown below the table.
    }
  }

  const columns: DataColumn<IssuedDocument>[] = [
    {
      key: 'document',
      header: t('issued.column.document'),
      render: (row) => (
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {typeLabel(row.type)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            <Verbatim>{row.businessReference}</Verbatim>
          </Typography>
        </Stack>
      ),
    },
    {
      key: 'language',
      header: t('issued.column.language'),
      render: (row) => td(`issued.languageName.${row.locale}`),
    },
    {
      key: 'version',
      header: t('issued.column.version'),
      render: (row) => <Verbatim>{format.number(row.version)}</Verbatim>,
    },
    {
      key: 'state',
      header: t('issued.column.state'),
      render: (row) => (
        <StatusChip tone={STATE_TONES[row.state]} label={td(`issuedState.${row.state}`)} />
      ),
    },
    {
      key: 'issuedAt',
      header: t('issued.column.issuedAt'),
      secondary: true,
      render: (row) => <Verbatim>{format.dateTime(row.issuedAt)}</Verbatim>,
    },
    {
      key: 'fingerprint',
      header: t('issued.column.fingerprint'),
      secondary: true,
      render: (row) => <Verbatim>{row.fingerprint}</Verbatim>,
    },
    {
      key: 'actions',
      header: t('issued.column.actions'),
      align: 'end',
      render: (row) => {
        const path = verificationPath(row.verificationUrl);
        return (
          <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
            {mayDownload ? (
              <Tooltip title={t('issued.download')}>
                <IconButton
                  size="small"
                  aria-label={t('issued.downloadLabel', describe(row))}
                  disabled={download.pending}
                  onClick={() => void openDownload(row)}
                >
                  <Icon icon={Download} size={18} />
                </IconButton>
              </Tooltip>
            ) : null}
            {path ? (
              <Tooltip title={t('issued.verifyLink')}>
                <IconButton
                  size="small"
                  component="a"
                  href={path}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('issued.verifyLabel', describe(row))}
                >
                  <Icon icon={ShieldCheck} size={18} />
                </IconButton>
              </Tooltip>
            ) : null}
            {mayRevoke && row.state !== 'revoked' ? (
              <Tooltip title={t('issued.revoke')}>
                <IconButton
                  size="small"
                  color="error"
                  aria-label={t('issued.revokeLabel', describe(row))}
                  onClick={() => setRevoking(row)}
                >
                  <Icon icon={CircleX} size={18} />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
        );
      },
    },
  ];

  return (
    <Panel
      title={title ?? t('issued.title')}
      icon={FileText}
      description={description ?? t('issued.description')}
      actions={
        mayGenerate ? (
          <Button
            variant="outlined"
            size="small"
            startIcon={<Icon icon={Plus} size={16} />}
            onClick={() => {
              setNotice(undefined);
              setIssuing(true);
            }}
          >
            {t('issued.issue')}
          </Button>
        ) : undefined
      }
      flush
    >
      <Stack spacing={1.5}>
        {notice ? (
          <Alert severity="success" role="status" onClose={() => setNotice(undefined)}>
            {notice}
          </Alert>
        ) : null}
        {mayView ? (
          <DataTable
            caption={title ?? t('issued.title')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.issueId}
            status={tableStatus(list.state)}
            labels={{ ...labels, emptyTitle: t('issued.empty'), emptyDescription: '' }}
            rowLabel={(row) => `${typeLabel(row.type)} ${row.businessReference}`}
            errorAction={
              <Button variant="outlined" onClick={list.reload}>
                {t('states.retry')}
              </Button>
            }
          />
        ) : null}
        {download.error ? <Alert severity="error">{errorMessage(download.error)}</Alert> : null}
      </Stack>

      {issuing ? (
        <IssueDialog
          sourceId={sourceId}
          types={types}
          onClose={() => setIssuing(false)}
          onIssued={(issued) => {
            setIssuing(false);
            setNotice(
              t('issued.issuedNotice', {
                type: typeLabel(issued.type),
                version: format.number(issued.version),
              }),
            );
            list.reload();
          }}
        />
      ) : null}
      {revoking ? (
        <RevokeDialog
          issued={revoking}
          onClose={() => setRevoking(undefined)}
          onRevoked={() => {
            setRevoking(undefined);
            list.reload();
          }}
        />
      ) : null}
    </Panel>
  );
}

function IssueDialog({
  sourceId,
  types,
  onClose,
  onIssued,
}: {
  sourceId: string;
  types: readonly IssuedDocumentType[];
  onClose: () => void;
  onIssued: (issued: IssuedDocument) => void;
}) {
  const { locale: screenLocale, t, td } = useLocale();
  const format = useFormatters();
  const errorMessage = useErrorMessage();
  const [type, setType] = useState<IssuedDocumentType>(types[0] ?? 'contractSummary');
  const [locale, setLocale] = useState<Locale>(screenLocale);
  const preview = useApi<IssuePreview>(
    `/api/v1/issued-documents/preview${query({ type, sourceId })}`,
  );
  const issue = useMutation(() =>
    apiRequest<IssuedDocument>('/api/v1/issued-documents', {
      method: 'POST',
      body: { type, sourceId, locale },
    }),
  );

  async function submit() {
    try {
      onIssued(await issue.run(undefined));
    } catch {
      // Shown in the dialog.
    }
  }

  const ready = preview.state.kind === 'ready' ? preview.state.data : undefined;
  const nextVersion = ready?.nextVersion[locale] ?? 1;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="issue-dialog-title">
      <DialogTitle id="issue-dialog-title">{t('issued.issueTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          {types.length > 1 ? (
            <TextField
              select
              label={t('issued.type')}
              value={type}
              onChange={(event) => setType(event.target.value as IssuedDocumentType)}
            >
              {types.map((value) => (
                <MenuItem key={value} value={value}>
                  {td(`issuedDocumentType.${value}`)}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <TextField
            select
            label={t('issued.language')}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {SUPPORTED_LOCALES.map((value) => (
              <MenuItem key={value} value={value} lang={value}>
                {td(`issued.languageName.${value}`)}
              </MenuItem>
            ))}
          </TextField>

          {preview.state.kind === 'loading' ? (
            <DialogContentText>{t('states.loadingTitle')}</DialogContentText>
          ) : preview.state.kind === 'error' ? (
            <Alert severity="error">{errorMessage(preview.state.error)}</Alert>
          ) : ready ? (
            <Stack spacing={1.5}>
              <DialogContentText>
                {t('issued.nextVersion', {
                  version: format.number(nextVersion),
                  reference: ready.businessReference,
                })}
                {nextVersion > 1 ? ` ${t('issued.supersedes')}` : ''}
              </DialogContentText>
              {ready.warnings.length > 0 ? (
                <Alert severity="warning">
                  <Typography variant="body2" sx={{ fontWeight: 600, marginBlockEnd: 0.5 }}>
                    {t('issued.warnings')}
                  </Typography>
                  <ul style={{ margin: 0, paddingInlineStart: '1.25rem' }}>
                    {ready.warnings.map((warning) => (
                      <li key={warning}>{td(`issueWarning.${warning}`)}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              {ready.restricted.length > 0 ? (
                <Alert severity="info">{t('issued.restricted')}</Alert>
              ) : null}
            </Stack>
          ) : null}
          {issue.error ? <Alert severity="error">{errorMessage(issue.error)}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!ready || issue.pending}
          onClick={() => void submit()}
        >
          {t('issued.confirmIssue')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RevokeDialog({
  issued,
  onClose,
  onRevoked,
}: {
  issued: IssuedDocument;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const revoke = useMutation(() =>
    apiRequest<IssuedDocument>(`/api/v1/issued-documents/${issued.issueId}/revoke`, {
      method: 'POST',
      body: { reason: reason.trim() },
    }),
  );

  async function submit() {
    try {
      await revoke.run(undefined);
      onRevoked();
    } catch {
      // Shown in the dialog.
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="revoke-dialog-title">
      <DialogTitle id="revoke-dialog-title">{t('issued.revokeTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>{t('issued.revokeDescription')}</DialogContentText>
          <TextField
            label={t('issued.revokeReason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            multiline
            minRows={2}
            required
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          {revoke.error ? <Alert severity="error">{errorMessage(revoke.error)}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          color="error"
          disabled={reason.trim().length < 3 || revoke.pending}
          onClick={() => void submit()}
        >
          {t('issued.confirmRevoke')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
