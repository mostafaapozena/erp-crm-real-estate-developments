import type { QuotationPage } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { DataTable, Icon, PageHeader, TableToolbar, type DataColumn } from '@alola/ui';
import { Plus } from '@alola/ui/icons';
import { useMemo } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { query } from '../api/client';
import { useSession } from '../api/session';
import { usePagedList } from '../api/usePagedList';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import { useCustomerNames, useProjectNames } from './lookups';
import {
  EnumChip,
  FilterSelect,
  ListFooter,
  ListSearch,
  QUOTATION_TONES,
  RequirePermission,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

type Quotation = QuotationPage['items'][number];

const LIST_STATES = ['active', 'expired', 'withdrawn'] as const;

/**
 * The quotation register (SALE-QUOTE-001): the latest revision of every quotation in the actor's
 * scope, newest first, filtered by the state as it reads — `expired` is computed from the validity on
 * the server, never stored. The filters live in the address, so a filtered list can be bookmarked and
 * the back button returns to it.
 */
export default function QuotationsPage() {
  return (
    <RequirePermission permission="sales.quotation.view">
      <QuotationsScreen />
    </RequirePermission>
  );
}

function QuotationsScreen() {
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const navigate = useNavigate();
  const labels = useTableLabels();
  const [params, setParams] = useSearchParams();
  const state = params.get('state') ?? '';
  const search = params.get('q') ?? '';
  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  const quotations = usePagedList<Quotation>(
    `/api/v1/sales/quotations${query({ limit: 50, state, search })}`,
  );
  const customerName = useCustomerNames(quotations.items.map((row) => row.customerId));
  const projectName = useProjectNames();

  const columns = useMemo<DataColumn<Quotation>[]>(
    () => [
      {
        key: 'number',
        header: t('quotations.number'),
        render: (row) => (
          <Box>
            <Box component="span" sx={{ fontWeight: 600 }}>
              <Verbatim>{row.quotationNumber}</Verbatim>
            </Box>
            <Typography variant="caption" color="text.secondary" component="div">
              {t('quotations.revisionShort', { revision: format.number(row.revision) })}
            </Typography>
          </Box>
        ),
      },
      {
        key: 'recipient',
        header: t('quotations.recipient'),
        render: (row) =>
          row.customerId
            ? (customerName(row.customerId) ?? t('quotations.customerHidden'))
            : t('quotations.leadRecipient'),
      },
      {
        key: 'unit',
        header: t('fields.unit'),
        render: (row) => (
          <Box>
            <Verbatim>{row.unitCode}</Verbatim>
            <Typography variant="caption" color="text.secondary" component="div">
              {projectName(row.projectId) ?? ''}
            </Typography>
          </Box>
        ),
      },
      {
        key: 'owner',
        header: t('sales.salesOwner'),
        render: (row) => <PersonName accountId={row.salesOwnerAccountId} />,
        secondary: true,
      },
      {
        key: 'issued',
        header: t('quotations.issuedOn'),
        render: (row) => <Verbatim>{format.dateTime(row.createdAt)}</Verbatim>,
        secondary: true,
      },
      {
        key: 'validUntil',
        header: t('quotations.validUntil'),
        render: (row) => <Verbatim>{format.date(row.validUntil)}</Verbatim>,
      },
      {
        key: 'total',
        header: t('fields.total'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.total)}</Verbatim>,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="quotationState" value={row.state} tones={QUOTATION_TONES} />
        ),
      },
    ],
    [customerName, format, projectName, t],
  );

  const activeFilters = [
    ...(state
      ? [
          {
            key: 'state',
            label: `${t('fields.state')}: ${td(`quotationState.${state}`)}`,
            onRemove: () => setParam('state', ''),
          },
        ]
      : []),
    ...(search
      ? [
          {
            key: 'search',
            label: `${t('actions.search')}: ${search}`,
            onRemove: () => setParam('q', ''),
          },
        ]
      : []),
  ];

  return (
    <Box>
      <PageHeader
        title={t('quotations.title')}
        subtitle={t('quotations.subtitle')}
        actions={
          can('sales.quotation.manage') ? (
            <Button
              variant="contained"
              component={RouterLink}
              to="/quotations/new"
              startIcon={<Icon icon={Plus} size={18} />}
            >
              {t('quotations.new')}
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        rows={quotations.items}
        rowKey={(row) => `${row.quotationId}-${row.revision}`}
        rowLabel={(row) => t('list.open', { label: row.quotationNumber })}
        status={tableStatus(quotations.state)}
        caption={t('quotations.title')}
        filtered={activeFilters.length > 0}
        onRowClick={(row) => void navigate(`/quotations/${row.quotationId}`)}
        errorAction={
          <Button variant="contained" onClick={quotations.reload}>
            {t('states.retry')}
          </Button>
        }
        labels={{ ...labels, emptyTitle: t('quotations.empty'), emptyDescription: t('quotations.emptyHint') }}
        toolbar={
          <TableToolbar
            search={
              <ListSearch
                value={search}
                onSubmit={(value) => setParam('q', value)}
                label={t('quotations.searchLabel')}
                ltr
              />
            }
            filters={
              <FilterSelect
                label={t('fields.state')}
                value={state}
                onChange={(value) => setParam('state', value)}
                options={LIST_STATES.map((value) => ({
                  value,
                  label: td(`quotationState.${value}`),
                }))}
              />
            }
            activeFilters={activeFilters}
            removeLabel={(label) => t('filters.remove', { label })}
          />
        }
        footer={
          <ListFooter
            shown={quotations.items.length}
            total={quotations.total}
            hasMore={quotations.hasMore}
            loadingMore={quotations.loadingMore}
            onLoadMore={quotations.loadMore}
            error={quotations.moreError}
          />
        }
      />
    </Box>
  );
}
