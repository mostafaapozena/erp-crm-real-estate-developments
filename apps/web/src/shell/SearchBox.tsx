import type { SearchHit, SearchResult, SearchType } from '@alola/contracts';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { apiRequest, query } from '../api/client';
import { useLocale } from '../locale';
import { useEnumLabel } from '../pages/shared';

/**
 * The shell's global search (CORE-SEARCH-001).
 *
 * It sends the typed text to `/api/v1/search`, which asks each module the signed-in person may read
 * to search **inside that person's scope**; nothing is filtered here. A hit is a label and an
 * identifier; choosing one opens the owning screen, which reads the record through its own scoped
 * route like any other link.
 */

/** Where each kind of hit opens. Kinds without a screen yet are not requested. */
const TARGETS: Partial<Record<SearchType, (id: string) => string>> = {
  lead: (id) => `/leads/${id}`,
  customer: () => '/customers',
  project: () => '/projects',
  unit: (id) => `/units/${id}`,
  reservation: (id) => `/reservations/${id}`,
  contract: (id) => `/contracts/${id}`,
  receipt: (id) => `/receipts/${id}`,
  task: () => '/tasks',
};
const TYPES = Object.keys(TARGETS).join(',');

/** The enumeration namespace a hit's status is labelled with. */
const STATUS_NAMESPACE: Partial<Record<SearchType, string>> = {
  lead: 'leadStage',
  project: 'projectStatus',
  unit: 'unitStatus',
  reservation: 'reservationState',
  contract: 'contractState',
  receipt: 'receiptState',
  task: 'taskState',
};

const DEBOUNCE_MS = 250;

export function SearchBox() {
  const { t, locale } = useLocale();
  const enumLabel = useEnumLabel();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = text.trim();
    if (term.length < 2) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      apiRequest<SearchResult>(`/api/v1/search${query({ q: term, types: TYPES })}`)
        .then(
          (result) => {
            if (!cancelled) setHits(result.items);
          },
          () => {
            if (!cancelled) setHits([]);
          },
        )
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text]);

  return (
    <Autocomplete<SearchHit, false, false, true>
      freeSolo
      size="small"
      // Below two characters nothing is searched, and stale hits are not shown.
      options={text.trim().length < 2 ? [] : hits}
      loading={loading}
      filterOptions={(options) => options}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
      groupBy={(option) => t(`search.types.${option.type}`)}
      inputValue={text}
      onInputChange={(_event, value) => setText(value)}
      onChange={(_event, value) => {
        if (value && typeof value !== 'string') {
          const target = TARGETS[value.type];
          if (target) void navigate(target(value.id));
          setText('');
        }
      }}
      noOptionsText={text.trim().length < 2 ? t('search.hint') : t('search.empty')}
      loadingText={t('states.loadingTitle')}
      sx={{ inlineSize: { xs: '100%', sm: 280 } }}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        const namespace = STATUS_NAMESPACE[option.type];
        return (
          <Box component="li" key={key} {...rest}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" component="span" sx={{ display: 'block' }}>
                {/* Names may be Arabic and codes Latin: isolate the direction, never force it. */}
                <bdi>{option.label}</bdi>
              </Typography>
              {option.name || (option.status && namespace) ? (
                <Typography variant="caption" color="text.secondary" component="span">
                  {option.name ? option.name[locale] : null}
                  {option.name && option.status && namespace ? ' · ' : null}
                  {option.status && namespace ? enumLabel(namespace, option.status) : null}
                </Typography>
              ) : null}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label={t('search.label')} placeholder={t('search.placeholder')} />
      )}
    />
  );
}
