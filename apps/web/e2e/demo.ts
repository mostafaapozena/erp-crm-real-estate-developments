import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Helpers shared by the end-to-end specs.
 *
 * The credentials come from `.demo-credentials.md`, the ignored file `npm run seed:demo` writes. The
 * suite deliberately signs in the ordinary way with those passwords rather than injecting a session:
 * a test that skips the front door proves nothing about the front door, and the sign-in flow — the
 * cookie, the refresh, the permission set that comes back — is the part every later assertion rests
 * on.
 */
const REPOSITORY_ROOT = join(import.meta.dirname, '../../../');
const CREDENTIALS_FILE = '.demo-credentials.md';

export interface DemoAccount {
  loginIdentifier: string;
  password: string;
}

/**
 * Parse the credentials file into accounts keyed by login identifier.
 *
 * A missing file is a **setup** failure, not a test failure, so the message says exactly what to run.
 * Nothing read here is ever printed: a failing assertion would otherwise put a working password into
 * a CI log.
 */
export function demoAccounts(): Map<string, DemoAccount> {
  let contents: string;
  try {
    contents = readFileSync(join(REPOSITORY_ROOT, CREDENTIALS_FILE), 'utf8');
  } catch {
    throw new Error(
      `${CREDENTIALS_FILE} was not found.\n` +
        'The end-to-end suite runs against the demonstration data. Create it with:\n' +
        '  npm run dev:services:up\n' +
        '  npm run seed:demo',
    );
  }

  const accounts = new Map<string, DemoAccount>();
  const lines = contents.split(/\r?\n/);
  let loginIdentifier: string | undefined;
  for (const line of lines) {
    const login = /^- Login: `(.+)`$/.exec(line);
    if (login?.[1]) {
      loginIdentifier = login[1];
      continue;
    }
    const password = /^- Password: `(.+)`$/.exec(line);
    if (password?.[1] && loginIdentifier) {
      accounts.set(loginIdentifier, { loginIdentifier, password: password[1] });
      loginIdentifier = undefined;
    }
  }
  if (accounts.size === 0) {
    throw new Error(`${CREDENTIALS_FILE} contains no accounts. Re-run: npm run seed:demo`);
  }
  return accounts;
}

/** The seeded logins the suite uses. None of them is administrative, so none needs a second factor. */
export const SALES_MANAGER = 'sales.manager@demo.invalid';
export const SALES_REP = 'sales.one@demo.invalid';
export const COLLECTOR = 'collections@demo.invalid';
/** Deployment-wide scope, read-only permissions: sees the legal entity a branch-scoped role does not. */
export const EXECUTIVE = 'executive@demo.invalid';

export const LABELS = {
  ar: {
    signIn: 'دخول',
    identifier: 'البريد الإلكتروني أو اسم المستخدم',
    password: 'كلمة المرور',
    switchTo: 'English',
    userMenu: 'قائمة المستخدم',
    openNavigation: 'فتح قائمة التنقل',
    dashboard: 'لوحة المتابعة',
    units: 'الوحدات',
    contracts: 'العقود',
    installments: 'الأقساط',
    receipts: 'الإيصالات',
    reminders: 'مركز التذكير',
    campaigns: 'الحملات',
    leads: 'العملاء المحتملون',
    reservations: 'الحجوزات',
  },
  en: {
    signIn: 'Sign in',
    identifier: 'Email or username',
    password: 'Password',
    switchTo: 'العربية',
    userMenu: 'User menu',
    openNavigation: 'Open navigation',
    dashboard: 'Dashboard',
    units: 'Units',
    contracts: 'Contracts',
    installments: 'Installments',
    receipts: 'Receipts',
    reminders: 'Reminder centre',
    campaigns: 'Campaigns',
    leads: 'Leads',
    reservations: 'Reservations',
  },
} as const;

/** Sign in through the real form and wait until the shell has rendered. */
export async function signIn(page: Page, login: string): Promise<void> {
  const account = demoAccounts().get(login);
  if (!account) throw new Error(`no seeded account for ${login} — re-run npm run seed:demo`);

  await page.goto('/');
  await page.getByLabel(LABELS.ar.identifier).fill(account.loginIdentifier);
  // By role and exact accessible name: the show-password toggle's name ("إظهار كلمة المرور")
  // contains the field's label, and the label's visible text carries the required asterisk.
  await page.getByRole('textbox', { name: LABELS.ar.password, exact: true }).fill(account.password);
  await page.getByRole('button', { name: LABELS.ar.signIn, exact: true }).click();
  // The user menu, not the navigation: on a phone the navigation is a drawer that starts closed, and
  // waiting for it would make every mobile test fail before it had begun.
  await expect(page.getByRole('button', { name: LABELS.ar.userMenu })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * The primary navigation, opened first if this viewport keeps it in a drawer.
 *
 * Addressed by id rather than by role: the shell renders two landmarks — the menu and the breadcrumb
 * trail — and `getByRole('navigation')` matches both. Selecting by the Arabic accessible name would
 * work too, and would then break the moment a test switched to English.
 */
export async function mainNav(page: Page) {
  // Either language: the accessible name follows the interface, and a test that switched to English
  // would otherwise look for an Arabic label that is no longer on the page.
  const toggle = page
    .getByRole('button', { name: LABELS.ar.openNavigation })
    .or(page.getByRole('button', { name: LABELS.en.openNavigation }));
  if (await toggle.isVisible()) {
    await toggle.click();
  }
  const navigation = page.locator('#app-navigation');
  await expect(navigation).toBeVisible();
  return navigation;
}

/**
 * Open a screen by URL.
 *
 * Navigating by address rather than by clicking the menu is on purpose in most specs: it proves the
 * screen stands on its own after a reload, which is how anyone arrives at a bookmarked page — and it
 * is the only honest way to test that hiding a menu entry is not what enforces a permission.
 */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('route-fallback')).toHaveCount(0, { timeout: 20_000 });
}
