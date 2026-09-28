import type {
  BrandAssetSlot,
  CompanyProfile,
  CompanyProfileInput,
  CompanyProfileRevision,
  Locale,
} from '@alola/contracts';
import { BRAND_ASSET_MAX_BYTES, BRAND_ASSET_SLOTS, BRAND_ASSET_TYPES } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ThemeProvider } from '@mui/material/styles';
import {
  Icon,
  PageHeader,
  SectionCard,
  StateView,
  StatusChip,
  createAppTheme,
  tokens,
  validateBrandColor,
} from '@alola/ui';
import {
  Building,
  Globe,
  History,
  ImageUp,
  Landmark,
  Palette,
  Printer,
  Save,
  Eye,
} from '@alola/ui/icons';
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiRequest } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { initialsOf, useBranding, useBrandingReload } from '../branding';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import { ErrorState, Verbatim } from './shared';

/**
 * Settings → Company identity (PLAT-022, PLAT-023, THEME-013).
 *
 * The deployment's identity is configuration: this screen edits the one company profile over the
 * existing F1 API, and the sign-in screen, sidebar, browser tab and printed documents read it at
 * runtime. Nothing here is a second company model.
 *
 * - **Draft, then publish.** The form is a local draft; nobody sees it until "Publish changes", which
 *   writes one audited revision guarded by the version the editor read (a concurrent edit is a
 *   conflict, not an overwrite). The preview shows the draft in the product's own components.
 * - **The colour is safe or refused.** The draft colour is validated with the same rule the server
 *   applies (`@alola/ui/brand`), against every contrast pair in use, before it can be published; the
 *   status colours never change.
 * - **Images go through the existing validated upload** — PNG or JPEG, magic bytes checked, 512 KB —
 *   and are stored in this deployment's database. No object-storage bypass is created.
 *
 * Reading needs `company.profile.view`; every change needs the administrative
 * `company.profile.manage`, which carries a second factor (SEC-017). The server enforces both.
 */
type Draft = Omit<CompanyProfileInput, 'otherIdentifiers'> & {
  otherIdentifiers: CompanyProfileInput['otherIdentifiers'];
};

const EMPTY_LABEL = { ar: '', en: '' };

function draftFrom(profile: CompanyProfile | undefined, timeZone: string): Draft {
  if (!profile) {
    return {
      legalName: { ...EMPTY_LABEL },
      tradeName: { ...EMPTY_LABEL },
      shortName: { ...EMPTY_LABEL },
      otherIdentifiers: [],
      country: 'EG',
      defaultLocale: 'ar',
      supportedLocales: ['ar', 'en'],
      timeZone,
      baseCurrency: 'EGP',
    };
  }
  const {
    assets: _assets,
    version: _version,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...fields
  } = profile;
  return fields;
}

/** Optional text fields are sent only when filled; an empty string is "not set", not a value. */
function toRequestBody(draft: Draft): CompanyProfileInput {
  const trimmed = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);
  const bilingual = (value: { ar: string; en: string } | undefined) =>
    value && (value.ar.trim() || value.en.trim())
      ? { ar: value.ar.trim(), en: value.en.trim() }
      : undefined;
  const optional = {
    commercialRegistration: trimmed(draft.commercialRegistration),
    taxRegistration: trimmed(draft.taxRegistration),
    phone: trimmed(draft.phone),
    email: trimmed(draft.email),
    website: trimmed(draft.website),
    primaryColor: trimmed(draft.primaryColor)?.toUpperCase(),
    address: bilingual(draft.address),
    documentFooter: bilingual(draft.documentFooter),
  };
  return {
    legalName: { ar: draft.legalName.ar.trim(), en: draft.legalName.en.trim() },
    tradeName: { ar: draft.tradeName.ar.trim(), en: draft.tradeName.en.trim() },
    shortName: { ar: draft.shortName.ar.trim(), en: draft.shortName.en.trim() },
    otherIdentifiers: draft.otherIdentifiers,
    country: draft.country.trim().toUpperCase(),
    defaultLocale: draft.defaultLocale,
    supportedLocales: draft.supportedLocales,
    timeZone: draft.timeZone.trim(),
    baseCurrency: draft.baseCurrency.trim().toUpperCase(),
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
  };
}

export default function CompanyIdentityPage() {
  const { can } = useSession();
  const { t } = useLocale();
  if (!can('company.profile.view')) {
    return (
      <StateView
        kind="forbidden"
        title={t('states.forbiddenTitle')}
        description={t('states.forbiddenDescription')}
      />
    );
  }
  return <CompanyIdentityScreen />;
}

function CompanyIdentityScreen() {
  const { t } = useLocale();
  const profile = useApi<CompanyProfile>('/api/v1/company/profile');

  if (profile.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (profile.state.kind === 'error' && profile.state.error.status !== 404) {
    return <ErrorState error={profile.state.error} onRetry={profile.reload} />;
  }
  const current = profile.state.kind === 'ready' ? profile.state.data : undefined;
  return (
    <IdentityEditor
      key={current ? current.version : 'new'}
      current={current}
      onPublished={profile.reload}
    />
  );
}

function IdentityEditor({
  current,
  onPublished,
}: {
  current: CompanyProfile | undefined;
  onPublished: () => void;
}) {
  const { t, locale } = useLocale();
  const { can } = useSession();
  const branding = useBranding();
  const reloadBranding = useBrandingReload();
  const format = useFormatters();
  const errorMessage = useErrorMessage();
  const canManage = can('company.profile.manage');

  const initial = useMemo(
    () => draftFrom(current, branding.timeZone),
    [current, branding.timeZone],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [published, setPublished] = useState(false);
  const dirty = JSON.stringify(toRequestBody(draft)) !== JSON.stringify(toRequestBody(initial));

  const colour = draft.primaryColor?.trim() ?? '';
  const colourCheck = colour ? validateBrandColor(colour) : undefined;
  const colourError = colourCheck && !colourCheck.ok ? colourCheck.reason : undefined;

  const publish = useMutation<void, CompanyProfile>(() =>
    current
      ? apiRequest<CompanyProfile>('/api/v1/company/profile', {
          method: 'PUT',
          body: { ...toRequestBody(draft), expectedVersion: current.version },
        })
      : apiRequest<CompanyProfile>('/api/v1/company/profile', {
          method: 'POST',
          body: toRequestBody(draft),
        }),
  );

  const setLabel =
    (field: 'legalName' | 'tradeName' | 'shortName' | 'address' | 'documentFooter', lang: Locale) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      setDraft((previous) => ({
        ...previous,
        [field]: { ...(previous[field] ?? EMPTY_LABEL), [lang]: event.target.value },
      }));
  const setText =
    (
      field:
        | 'commercialRegistration'
        | 'taxRegistration'
        | 'phone'
        | 'email'
        | 'website'
        | 'country'
        | 'timeZone'
        | 'baseCurrency'
        | 'primaryColor',
    ) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      setDraft((previous) => ({ ...previous, [field]: event.target.value }));

  const issueFor = (path: string) =>
    publish.error?.issues?.find((issue) => issue.path.join('.').startsWith(path));
  const fieldError = (path: string) => {
    const issue = issueFor(path);
    return issue
      ? { error: true, helperText: errorMessage(new ApiError(400, 'VALIDATION_FAILED')) }
      : {};
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage || colourError || publish.pending) return;
    try {
      await publish.run();
      setPublished(true);
      await reloadBranding();
      onPublished();
    } catch {
      // Rendered from `publish.error`; the draft is kept so nothing typed is lost.
    }
  }

  const readOnly = !canManage;
  const common = { disabled: readOnly, fullWidth: true } as const;

  return (
    <Box component="form" onSubmit={(event) => void submit(event)} noValidate>
      <PageHeader
        title={t('company.title')}
        subtitle={t('company.subtitle')}
        {...(current
          ? {
              meta: (
                <>
                  <span>{t('company.version', { version: current.version })}</span>
                  <span>
                    {t('company.updatedAt', { date: format.dateTime(current.updatedAt) })}
                  </span>
                </>
              ),
            }
          : {})}
        {...(dirty
          ? { status: <StatusChip tone="warning" label={t('company.unpublished')} /> }
          : {})}
        actions={
          canManage ? (
            <>
              <Button
                variant="outlined"
                color="inherit"
                disabled={!dirty || publish.pending}
                onClick={() => {
                  setDraft(initial);
                  publish.reset();
                }}
              >
                {t('company.discard')}
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={(!dirty && Boolean(current)) || Boolean(colourError) || publish.pending}
                startIcon={<Icon icon={Save} size={18} />}
              >
                {publish.pending
                  ? t('company.publishing')
                  : current
                    ? t('company.publish')
                    : t('company.create')}
              </Button>
            </>
          ) : undefined
        }
        banner={
          <Stack spacing={1.5}>
            {!current ? (
              <Alert severity="info" variant="outlined">
                <AlertTitle>{t('company.firstTimeTitle')}</AlertTitle>
                {t('company.firstTimeBody')}
              </Alert>
            ) : null}
            {readOnly ? (
              <Alert severity="info" variant="outlined">
                {t('company.readOnly')}
              </Alert>
            ) : null}
            {publish.error ? (
              <Alert severity="error" role="alert">
                {errorMessage(publish.error)}
              </Alert>
            ) : null}
            {published && !dirty && !publish.error ? (
              <Alert severity="success" role="status">
                {t('company.published')}
              </Alert>
            ) : null}
          </Stack>
        }
      />

      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 400px' },
          alignItems: 'start',
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          <SectionCard title={t('company.sections.names')} icon={Building}>
            <FieldGrid>
              <TextField
                {...common}
                label={t('company.fields.legalNameAr')}
                value={draft.legalName.ar}
                onChange={setLabel('legalName', 'ar')}
                required
                slotProps={{ htmlInput: { lang: 'ar', dir: 'rtl', maxLength: 200 } }}
                {...fieldError('legalName.ar')}
              />
              <TextField
                {...common}
                label={t('company.fields.legalNameEn')}
                value={draft.legalName.en}
                onChange={setLabel('legalName', 'en')}
                required
                slotProps={{ htmlInput: { lang: 'en', dir: 'ltr', maxLength: 200 } }}
                {...fieldError('legalName.en')}
              />
              <TextField
                {...common}
                label={t('company.fields.tradeNameAr')}
                value={draft.tradeName.ar}
                onChange={setLabel('tradeName', 'ar')}
                required
                slotProps={{ htmlInput: { lang: 'ar', dir: 'rtl', maxLength: 200 } }}
                {...fieldError('tradeName.ar')}
              />
              <TextField
                {...common}
                label={t('company.fields.tradeNameEn')}
                value={draft.tradeName.en}
                onChange={setLabel('tradeName', 'en')}
                required
                slotProps={{ htmlInput: { lang: 'en', dir: 'ltr', maxLength: 200 } }}
                {...fieldError('tradeName.en')}
              />
              <TextField
                {...common}
                label={t('company.fields.shortNameAr')}
                value={draft.shortName.ar}
                onChange={setLabel('shortName', 'ar')}
                required
                helperText={t('company.hints.shortName')}
                slotProps={{ htmlInput: { lang: 'ar', dir: 'rtl', maxLength: 40 } }}
                {...fieldError('shortName.ar')}
              />
              <TextField
                {...common}
                label={t('company.fields.shortNameEn')}
                value={draft.shortName.en}
                onChange={setLabel('shortName', 'en')}
                required
                helperText={t('company.hints.shortName')}
                slotProps={{ htmlInput: { lang: 'en', dir: 'ltr', maxLength: 40 } }}
                {...fieldError('shortName.en')}
              />
            </FieldGrid>
          </SectionCard>

          <SectionCard title={t('company.sections.brand')} icon={Palette}>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <Box
                  aria-hidden
                  sx={{
                    inlineSize: 48,
                    blockSize: 48,
                    borderRadius: 2,
                    border: 1,
                    borderColor: 'divider',
                    flexShrink: 0,
                    backgroundColor:
                      colourCheck && colourCheck.ok ? colourCheck.primary : tokens.primary,
                  }}
                />
                <TextField
                  disabled={readOnly}
                  label={t('company.fields.primaryColor')}
                  value={draft.primaryColor ?? ''}
                  onChange={setText('primaryColor')}
                  placeholder={tokens.primary}
                  error={Boolean(colourError)}
                  helperText={
                    colourError === 'BRAND_COLOR_INVALID'
                      ? t('company.colorInvalid')
                      : colourError === 'BRAND_COLOR_CONTRAST'
                        ? t('company.colorContrastFailed')
                        : colour
                          ? t('company.colorAccepted')
                          : `${t('company.colorDefault')} — ${t('company.hints.primaryColor')}`
                  }
                  slotProps={{ htmlInput: { dir: 'ltr', maxLength: 7, spellCheck: false } }}
                  sx={{ flex: '1 1 260px' }}
                />
                {canManage && colour ? (
                  <Button
                    variant="text"
                    onClick={() => setDraft((previous) => ({ ...previous, primaryColor: '' }))}
                  >
                    {t('company.useDefaultColor')}
                  </Button>
                ) : null}
              </Box>
            </Stack>
          </SectionCard>

          <LogoSection current={current} canManage={canManage} onUploaded={reloadBranding} />

          <SectionCard title={t('company.sections.registration')} icon={Landmark}>
            <FieldGrid>
              <TextField
                {...common}
                label={t('company.fields.commercialRegistration')}
                value={draft.commercialRegistration ?? ''}
                onChange={setText('commercialRegistration')}
                helperText={t('company.hints.optional')}
                slotProps={{ htmlInput: { dir: 'ltr', maxLength: 60 } }}
              />
              <TextField
                {...common}
                label={t('company.fields.taxRegistration')}
                value={draft.taxRegistration ?? ''}
                onChange={setText('taxRegistration')}
                helperText={t('company.hints.optional')}
                slotProps={{ htmlInput: { dir: 'ltr', maxLength: 60 } }}
              />
            </FieldGrid>
          </SectionCard>

          <SectionCard title={t('company.sections.contact')} icon={Globe}>
            <FieldGrid>
              <TextField
                {...common}
                label={t('company.fields.phone')}
                value={draft.phone ?? ''}
                onChange={setText('phone')}
                helperText={t('company.hints.optional')}
                slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'tel', maxLength: 32 } }}
                {...fieldError('phone')}
              />
              <TextField
                {...common}
                label={t('company.fields.email')}
                value={draft.email ?? ''}
                onChange={setText('email')}
                helperText={t('company.hints.optional')}
                slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'email', maxLength: 254 } }}
                {...fieldError('email')}
              />
              <TextField
                {...common}
                label={t('company.fields.website')}
                value={draft.website ?? ''}
                onChange={setText('website')}
                helperText={t('company.hints.website')}
                slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'url', maxLength: 200 } }}
                {...fieldError('website')}
              />
              <Box />
              <TextField
                {...common}
                multiline
                minRows={2}
                label={t('company.fields.addressAr')}
                value={draft.address?.ar ?? ''}
                onChange={setLabel('address', 'ar')}
                slotProps={{ htmlInput: { lang: 'ar', dir: 'rtl', maxLength: 600 } }}
                {...fieldError('address')}
              />
              <TextField
                {...common}
                multiline
                minRows={2}
                label={t('company.fields.addressEn')}
                value={draft.address?.en ?? ''}
                onChange={setLabel('address', 'en')}
                slotProps={{ htmlInput: { lang: 'en', dir: 'ltr', maxLength: 600 } }}
                {...fieldError('address')}
              />
            </FieldGrid>
          </SectionCard>

          <SectionCard title={t('company.sections.regional')} icon={Globe}>
            <FieldGrid>
              <TextField
                {...common}
                label={t('company.fields.country')}
                value={draft.country}
                onChange={setText('country')}
                helperText={t('company.hints.country')}
                slotProps={{ htmlInput: { dir: 'ltr', maxLength: 2 } }}
                {...fieldError('country')}
              />
              <TextField
                {...common}
                label={t('company.fields.baseCurrency')}
                value={draft.baseCurrency}
                onChange={setText('baseCurrency')}
                helperText={t('company.hints.currency')}
                slotProps={{ htmlInput: { dir: 'ltr', maxLength: 3 } }}
                {...fieldError('baseCurrency')}
              />
              <TextField
                {...common}
                label={t('company.fields.timeZone')}
                value={draft.timeZone}
                onChange={setText('timeZone')}
                slotProps={{ htmlInput: { dir: 'ltr', maxLength: 64 } }}
                {...fieldError('timeZone')}
              />
              <TextField
                {...common}
                select
                label={t('company.fields.defaultLocale')}
                value={draft.defaultLocale}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    defaultLocale: event.target.value as Locale,
                    supportedLocales: previous.supportedLocales.includes(
                      event.target.value as Locale,
                    )
                      ? previous.supportedLocales
                      : [...previous.supportedLocales, event.target.value as Locale],
                  }))
                }
              >
                {(['ar', 'en'] as const).map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(`company.locales.${value}`)}
                  </MenuItem>
                ))}
              </TextField>
              <Box component="fieldset" sx={{ border: 0, margin: 0, padding: 0 }}>
                <FormLabel component="legend" sx={{ typography: 'caption', fontWeight: 600 }}>
                  {t('company.fields.supportedLocales')}
                </FormLabel>
                <FormGroup row>
                  {(['ar', 'en'] as const).map((value) => (
                    <FormControlLabel
                      key={value}
                      control={
                        <Checkbox
                          disabled={readOnly || value === draft.defaultLocale}
                          checked={draft.supportedLocales.includes(value)}
                          onChange={(event) =>
                            setDraft((previous) => ({
                              ...previous,
                              supportedLocales: event.target.checked
                                ? [...previous.supportedLocales, value]
                                : previous.supportedLocales.filter((entry) => entry !== value),
                            }))
                          }
                        />
                      }
                      label={t(`company.locales.${value}`)}
                    />
                  ))}
                </FormGroup>
              </Box>
            </FieldGrid>
          </SectionCard>

          <SectionCard title={t('company.sections.documents')} icon={Printer}>
            <FieldGrid>
              <TextField
                {...common}
                multiline
                minRows={2}
                label={t('company.fields.footerAr')}
                value={draft.documentFooter?.ar ?? ''}
                onChange={setLabel('documentFooter', 'ar')}
                helperText={t('company.hints.optional')}
                slotProps={{ htmlInput: { lang: 'ar', dir: 'rtl', maxLength: 600 } }}
              />
              <TextField
                {...common}
                multiline
                minRows={2}
                label={t('company.fields.footerEn')}
                value={draft.documentFooter?.en ?? ''}
                onChange={setLabel('documentFooter', 'en')}
                helperText={t('company.hints.optional')}
                slotProps={{ htmlInput: { lang: 'en', dir: 'ltr', maxLength: 600 } }}
              />
            </FieldGrid>
          </SectionCard>

          {current ? <HistorySection /> : null}
        </Stack>

        <Box sx={{ position: { xl: 'sticky' }, insetBlockStart: { xl: 88 }, minWidth: 0 }}>
          <Preview draft={draft} current={current} locale={locale} />
        </Box>
      </Box>
    </Box>
  );
}

function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
      }}
    >
      {children}
    </Box>
  );
}

/* --------------------------------------------------------------------- logos */

function LogoSection({
  current,
  canManage,
  onUploaded,
}: {
  current: CompanyProfile | undefined;
  canManage: boolean;
  onUploaded: () => Promise<void>;
}) {
  const { t } = useLocale();
  const branding = useBranding();
  return (
    <SectionCard
      title={t('company.sections.logos')}
      icon={ImageUp}
      description={t('company.hints.image')}
    >
      {!current ? (
        <Typography variant="body2" color="text.secondary">
          {t('company.imagesAfterProfile')}
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
          }}
        >
          {BRAND_ASSET_SLOTS.map((slot) => (
            <LogoSlot
              key={slot}
              slot={slot}
              url={branding.assets[slot]?.url}
              canManage={canManage}
              onUploaded={onUploaded}
            />
          ))}
        </Box>
      )}
    </SectionCard>
  );
}

function LogoSlot({
  slot,
  url,
  canManage,
  onUploaded,
}: {
  slot: BrandAssetSlot;
  url: string | undefined;
  canManage: boolean;
  onUploaded: () => Promise<void>;
}) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const upload = useMutation<File, unknown>((file) =>
    apiRequest(`/api/v1/company/profile/assets/${slot}`, {
      method: 'PUT',
      file,
      fileType: file.type,
    }),
  );

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setDone(false);
    setProblem(undefined);
    if (!file) return;
    if (!(BRAND_ASSET_TYPES as readonly string[]).includes(file.type)) {
      setProblem(t('company.imageWrongType'));
      return;
    }
    if (file.size > BRAND_ASSET_MAX_BYTES) {
      setProblem(t('company.imageTooLarge'));
      return;
    }
    try {
      await upload.run(file);
      setDone(true);
      await onUploaded();
    } catch {
      // Rendered from `upload.error`.
    }
  }

  const inputId = `brand-asset-${slot}`;
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        padding: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        minWidth: 0,
      }}
    >
      <Typography component="h3" variant="subtitle2">
        {t(`company.logoSlots.${slot}`)}
      </Typography>
      <Box
        sx={{
          blockSize: 88,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 1.5,
          bgcolor: tokens.neutralSoft,
          overflow: 'hidden',
        }}
      >
        {url ? (
          <Box
            component="img"
            src={url}
            alt={t(`company.logoSlots.${slot}`)}
            sx={{ maxBlockSize: 72, maxInlineSize: '90%', objectFit: 'contain' }}
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t('company.noImage')}
          </Typography>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t(`company.logoSlotHints.${slot}`)}
      </Typography>
      {canManage ? (
        <>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept={BRAND_ASSET_TYPES.join(',')}
            hidden
            onChange={(event) => void choose(event)}
          />
          <Button
            variant="outlined"
            size="small"
            disabled={upload.pending}
            onClick={() => input.current?.click()}
            startIcon={<Icon icon={ImageUp} size={16} />}
          >
            {upload.pending
              ? t('company.uploading')
              : url
                ? t('company.replaceImage')
                : t('company.uploadImage')}
          </Button>
        </>
      ) : null}
      {problem ? (
        <Alert severity="error" role="alert">
          {problem}
        </Alert>
      ) : null}
      {upload.error ? (
        <Alert severity="error" role="alert">
          {errorMessage(upload.error)}
        </Alert>
      ) : null}
      {done ? (
        <Alert severity="success" role="status">
          {t('company.imageUploaded')}
        </Alert>
      ) : null}
    </Box>
  );
}

/* ------------------------------------------------------------------- history */

function HistorySection() {
  const { t } = useLocale();
  const format = useFormatters();
  const revisions = useApi<{ items: CompanyProfileRevision[] }>(
    '/api/v1/company/profile/revisions?limit=10',
  );
  const items = revisions.state.kind === 'ready' ? revisions.state.data.items : [];
  return (
    <SectionCard title={t('company.sections.history')} icon={History} flush>
      {revisions.state.kind === 'loading' ? (
        <StateView variant="inline" kind="loading" title={t('states.loadingTitle')} />
      ) : items.length === 0 ? (
        <StateView variant="inline" kind="empty" title={t('company.noHistory')} />
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((revision, index) => (
            <Box
              component="li"
              key={revision.version}
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 2,
                paddingInline: 2.5,
                paddingBlock: 1.5,
                borderBlockStart: index === 0 ? 0 : 1,
                borderColor: 'divider',
              }}
            >
              <StatusChip
                tone="neutral"
                label={t('company.version', { version: revision.version })}
              />
              <Typography variant="body2" color="text.secondary">
                <Verbatim>{format.dateTime(revision.changedAt)}</Verbatim>
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('company.changedBy')}
                </Typography>
                <PersonName accountId={revision.changedBy} />
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------- preview */

/**
 * The draft, drawn in the product's own components under a theme built from the draft colour. The
 * nested theme has no baseline, so nothing outside this panel changes while someone is typing.
 */
function Preview({
  draft,
  current,
  locale,
}: {
  draft: Draft;
  current: CompanyProfile | undefined;
  locale: Locale;
}) {
  const { t } = useLocale();
  const branding = useBranding();
  const check = draft.primaryColor?.trim() ? validateBrandColor(draft.primaryColor) : undefined;
  const palette = check && check.ok ? check.palette : undefined;
  const theme = useMemo(() => createAppTheme(locale, palette), [locale, palette]);
  const name = draft.tradeName[locale].trim() || t('app.title');
  const short = draft.shortName[locale].trim() || name;
  const logo = current ? branding.assets.logo?.url : undefined;
  const address = draft.address?.[locale]?.trim();

  const mark = logo ? (
    <Box
      component="img"
      src={logo}
      alt={name}
      sx={{ blockSize: 36, maxInlineSize: 110, objectFit: 'contain' }}
    />
  ) : (
    <Box
      aria-hidden
      sx={{
        inlineSize: 36,
        blockSize: 36,
        borderRadius: 2,
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        fontWeight: 700,
      }}
    >
      {initialsOf(short).slice(0, 1)}
    </Box>
  );

  return (
    <SectionCard
      title={t('company.sections.preview')}
      icon={Eye}
      description={t('company.previewNote')}
    >
      <ThemeProvider theme={theme}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('company.previewSidebar')}
            </Typography>
            <Box
              sx={{
                marginBlockStart: 0.75,
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                padding: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
              }}
            >
              {mark}
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.875rem' }} noWrap>
                  {name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('shell.productDescriptor')}
                </Typography>
              </Box>
            </Box>
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('company.previewSignIn')}
            </Typography>
            <Box
              sx={{
                marginBlockStart: 0.75,
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                padding: 2,
                bgcolor: 'primary.light',
                display: 'grid',
                justifyItems: 'center',
                gap: 1,
              }}
            >
              {mark}
              <Typography sx={{ fontWeight: 700 }}>{name}</Typography>
              <Button variant="contained" size="small" tabIndex={-1} aria-hidden>
                {t('auth.signIn')}
              </Button>
            </Box>
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('company.previewDocument')}
            </Typography>
            <Box
              sx={{
                marginBlockStart: 0.75,
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                padding: 2,
                bgcolor: 'background.paper',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  paddingBlockEnd: 1.25,
                  borderBlockEnd: 3,
                  borderColor: 'primary.main',
                }}
              >
                {mark}
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.875rem' }}>
                    {draft.legalName[locale].trim() || name}
                  </Typography>
                  {draft.commercialRegistration ? (
                    <Typography variant="caption" color="text.secondary" component="p">
                      {`${t('company.fields.commercialRegistration')}: `}
                      <Verbatim>{draft.commercialRegistration}</Verbatim>
                    </Typography>
                  ) : null}
                </Box>
              </Box>
              <Typography sx={{ fontWeight: 600, marginBlock: 1.5 }}>
                {t('company.documentTitle')}
              </Typography>
              <Box
                sx={{
                  blockSize: 8,
                  borderRadius: 1,
                  bgcolor: tokens.neutralSoft,
                  marginBlockEnd: 1,
                }}
              />
              <Box
                sx={{
                  blockSize: 8,
                  inlineSize: '70%',
                  borderRadius: 1,
                  bgcolor: tokens.neutralSoft,
                }}
              />
              {draft.documentFooter?.[locale]?.trim() || address ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="p"
                  sx={{
                    marginBlockStart: 1.5,
                    paddingBlockStart: 1,
                    borderBlockStart: 1,
                    borderColor: 'divider',
                  }}
                >
                  {draft.documentFooter?.[locale]?.trim() || address}
                </Typography>
              ) : null}
            </Box>
          </Box>
        </Stack>
      </ThemeProvider>
    </SectionCard>
  );
}
