import type { Customer, Lead, Opportunity } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { apiRequest } from '../api/client';
import { useSession } from '../api/session';
import { useMutation } from '../api/useApi';
import { useBranding } from '../branding';
import { useErrorMessage } from '../errors';
import { useLocale } from '../locale';

interface ConvertResult {
  lead: Lead;
  customer: Customer;
  customerCreated: boolean;
  opportunity?: Opportunity;
}

/**
 * Convert a lead into a customer (CRM-LEAD-005), optionally opening an opportunity in the same
 * transaction. Conversion is idempotent on the server — converting twice returns the customer it
 * already has — and an existing customer with the lead's phone is linked rather than duplicated, so
 * the dialog says which of the two happened afterwards instead of promising one in advance.
 *
 * Opening an opportunity is its own permission (`crm.opportunity.manage`); without it the option is
 * not offered, and the server refuses the whole conversion if it is asked for anyway.
 */
export function ConvertLeadPanel({ lead, onConverted }: { lead: Lead; onConverted: () => void }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <Alert
      severity="info"
      variant="outlined"
      sx={{ '& .MuiAlert-message': { inlineSize: '100%' } }}
    >
      <Box sx={{ marginBlockEnd: 1.25 }}>{t('convert.hint')}</Box>
      <Button variant="outlined" size="small" onClick={() => setOpen(true)}>
        {t('convert.action')}
      </Button>
      {open ? (
        <ConvertDialog lead={lead} onClose={() => setOpen(false)} onConverted={onConverted} />
      ) : null}
    </Alert>
  );
}

function ConvertDialog({
  lead,
  onClose,
  onConverted,
}: {
  lead: Lead;
  onClose: () => void;
  onConverted: () => void;
}) {
  const { t } = useLocale();
  const { can } = useSession();
  const { baseCurrency } = useBranding();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const mayOpen = can('crm.opportunity.manage');
  const [withOpportunity, setWithOpportunity] = useState(mayOpen);
  const [expectedValue, setExpectedValue] = useState('');
  const [expectedCloseOn, setExpectedCloseOn] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<ConvertResult | undefined>();
  const currency = lead.budgetMax?.currency ?? lead.budgetMin?.currency ?? baseCurrency;

  const convert = useMutation(() =>
    apiRequest<ConvertResult>(`/api/v1/crm/leads/${lead.leadId}/convert`, {
      method: 'POST',
      body:
        withOpportunity && mayOpen
          ? {
              opportunity: {
                ...(expectedValue.trim() && currency
                  ? { expectedValue: { amount: expectedValue.trim(), currency } }
                  : {}),
                ...(expectedCloseOn ? { expectedCloseOn } : {}),
                ...(notes.trim() ? { notes: notes.trim() } : {}),
              },
            }
          : {},
    }),
  );

  async function submit() {
    try {
      setResult(await convert.run(undefined));
      onConverted();
    } catch {
      /* shown in the dialog */
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="convert-title">
      <DialogTitle id="convert-title">{t('convert.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          {result ? (
            <Alert severity="success" role="status">
              {result.customerCreated ? t('convert.created') : t('convert.linked')}
              {result.opportunity ? ` ${t('convert.opportunityOpened')}` : ''}
            </Alert>
          ) : (
            <>
              <DialogContentText>{t('convert.explanation')}</DialogContentText>
              {mayOpen ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={withOpportunity}
                      onChange={(event) => setWithOpportunity(event.target.checked)}
                    />
                  }
                  label={t('convert.withOpportunity')}
                />
              ) : null}
              {withOpportunity && mayOpen ? (
                <Stack spacing={2}>
                  {currency ? (
                    <TextField
                      label={t('opportunities.expectedValue')}
                      value={expectedValue}
                      onChange={(event) => setExpectedValue(event.target.value)}
                      helperText={t('plan.optional')}
                      slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
                    />
                  ) : null}
                  <TextField
                    label={t('opportunities.expectedCloseOn')}
                    type="date"
                    value={expectedCloseOn}
                    onChange={(event) => setExpectedCloseOn(event.target.value)}
                    helperText={t('plan.optional')}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    label={t('fields.notes')}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    multiline
                    minRows={2}
                  />
                </Stack>
              ) : null}
              {convert.error ? (
                <Alert severity="error" role="alert">
                  {errorMessage(convert.error)}
                </Alert>
              ) : null}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {result ? (
          <>
            <Button onClick={onClose}>{t('actions.close')}</Button>
            {can('crm.customer.view') ? (
              <Button
                variant="contained"
                onClick={() => void navigate(`/customers/${result.customer.customerId}`)}
              >
                {t('convert.openCustomer')}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t('actions.cancel')}</Button>
            <Button variant="contained" disabled={convert.pending} onClick={() => void submit()}>
              {t('convert.confirm')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
