import { SUPPORTED_LOCALES, type Locale, type PublicBranding } from '@alola/contracts';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';

/**
 * The deployment's branding, loaded at runtime (PLAT-023, ADR-0027).
 *
 * One build of this application serves every client company; each deployment answers its own
 * `/api/v1/branding`. So the company name, logo, favicon and brand colour are read when the page
 * loads — never compiled in — and changing them needs neither a rebuild nor a restart.
 *
 * **Every failure falls back to the neutral product identity.** An unreachable API, a malformed
 * answer or a slow network renders the product's own name and the approved palette, never a blank
 * screen and never a guess. The fallback marks itself as a demonstration, because the only honest
 * statement about an environment whose configuration cannot be read is not to claim it is live.
 */
export const NEUTRAL_BRANDING: PublicBranding = {
  configured: false,
  demonstration: true,
  defaultLocale: 'ar',
  supportedLocales: [...SUPPORTED_LOCALES],
  timeZone: 'UTC',
  assets: {},
  version: 0,
};

/** How long the first paint waits for branding before rendering the neutral identity. */
const BRANDING_WAIT_MS = 1500;

const BrandingContext = createContext<PublicBranding>(NEUTRAL_BRANDING);
/** Re-reads branding — after Settings → Company identity publishes a change, so no reload is needed. */
const BrandingReloadContext = createContext<() => Promise<void>>(() => Promise.resolve());

function isBranding(value: unknown): value is PublicBranding {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PublicBranding>;
  return (
    typeof candidate.configured === 'boolean' &&
    typeof candidate.demonstration === 'boolean' &&
    typeof candidate.timeZone === 'string' &&
    typeof candidate.defaultLocale === 'string' &&
    SUPPORTED_LOCALES.includes(candidate.defaultLocale) &&
    Array.isArray(candidate.supportedLocales) &&
    candidate.supportedLocales.length > 0 &&
    candidate.supportedLocales.every((locale) => SUPPORTED_LOCALES.includes(locale)) &&
    typeof candidate.assets === 'object' &&
    candidate.assets !== null
  );
}

export async function loadBranding(signal?: AbortSignal): Promise<PublicBranding> {
  try {
    const response = await fetch('/api/v1/branding', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return NEUTRAL_BRANDING;
    const body: unknown = await response.json();
    return isBranding(body) ? body : NEUTRAL_BRANDING;
  } catch {
    return NEUTRAL_BRANDING;
  }
}

/**
 * Loads branding once, then renders its children. Rendering waits for the answer — or for
 * `BRANDING_WAIT_MS`, whichever comes first — so the first frame is already in the company's language
 * and colour rather than flashing the neutral identity and then switching.
 */
export function BrandingProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** Supplied by tests, or by a host that already knows the branding. */
  initial?: PublicBranding;
}) {
  const [branding, setBranding] = useState<PublicBranding | undefined>(initial);

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) setBranding((current) => current ?? NEUTRAL_BRANDING);
    }, BRANDING_WAIT_MS);
    void loadBranding(controller.signal).then((loaded) => {
      settled = true;
      window.clearTimeout(timer);
      setBranding(loaded);
    });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [initial]);

  const reload = useCallback(async () => {
    setBranding(await loadBranding());
  }, []);

  if (!branding) return null;
  return (
    <BrandingReloadContext value={reload}>
      <BrandingContext value={branding}>{children}</BrandingContext>
    </BrandingReloadContext>
  );
}

export function useBrandingReload(): () => Promise<void> {
  return use(BrandingReloadContext);
}

export function useBranding(): PublicBranding {
  return use(BrandingContext);
}

/** The short name in a language, or `undefined` when the deployment has not configured one. */
export function brandName(branding: PublicBranding, locale: Locale): string | undefined {
  return branding.shortName?.[locale];
}

/**
 * The company's display (trade) name in a language — what the sidebar and the sign-in screen show —
 * falling back to the short name, or `undefined` when nothing is configured.
 */
export function brandDisplayName(branding: PublicBranding, locale: Locale): string | undefined {
  return branding.tradeName?.[locale] ?? branding.shortName?.[locale];
}

/** Up to two initials for a name, for the logo fallback and for avatars. Works for Arabic too. */
export function initialsOf(name: string): string {
  const words = name
    .replace(/^(شركة|مؤسسة)\s+/u, '')
    .split(/\s+/u)
    .filter((word) => word.length > 0 && !/^(ال|و|لل|للت)$/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word.replace(/^ال/u, '')][0] ?? '');
  return letters.join('').toUpperCase();
}

/**
 * Point the browser tab's icon at the configured favicon. With none configured the document keeps
 * whatever the host page declares, which for this product is no icon at all rather than a client's.
 */
export function applyFavicon(branding: PublicBranding): void {
  const favicon = branding.assets.favicon;
  if (!favicon) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = favicon.contentType;
  link.href = favicon.url;
}
