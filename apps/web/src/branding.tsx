import { SUPPORTED_LOCALES, type Locale, type PublicBranding } from '@alola/contracts';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';

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
  assets: {},
  version: 0,
};

/** How long the first paint waits for branding before rendering the neutral identity. */
const BRANDING_WAIT_MS = 1500;

const BrandingContext = createContext<PublicBranding>(NEUTRAL_BRANDING);

function isBranding(value: unknown): value is PublicBranding {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PublicBranding>;
  return (
    typeof candidate.configured === 'boolean' &&
    typeof candidate.demonstration === 'boolean' &&
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

  if (!branding) return null;
  return <BrandingContext value={branding}>{children}</BrandingContext>;
}

export function useBranding(): PublicBranding {
  return use(BrandingContext);
}

/** The display name in a language, or `undefined` when the deployment has not configured one. */
export function brandName(branding: PublicBranding, locale: Locale): string | undefined {
  return branding.shortName?.[locale];
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
