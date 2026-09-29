import type { Task } from '@alola/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { createI18n } from '../i18n';
import { FIRST_RENDER, WARM_UP_BUDGET_MS, warmLazyModules } from '../testing/warm-up';

/**
 * The tasks screen (CORE-TASK-001, CORE-TASK-004).
 *
 * Pinned here: an overdue task says so in words, not by colour alone; and the calendar files a task on
 * the organization-calendar day the server reports (`dueOn`), with the week starting on Saturday.
 */

const session = {
  account: {
    accountId: 'acc_test',
    loginIdentifier: 'agent@demo.invalid',
    displayName: 'Test Agent',
    state: 'active',
    mfaEnabled: false,
    mfaRequired: false,
    credentialVersion: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  permissions: ['task.create'],
  scope: {
    level: 'self',
    teamIds: [],
    departmentIds: [],
    branchIds: [],
    projectIds: [],
    legalEntityIds: [],
  },
};

const task = (overrides: Partial<Record<keyof Task, unknown>>): Task =>
  ({
    taskId: 'task_000001',
    title: 'Call back the customer',
    priority: 'high',
    state: 'open',
    assigneeAccountId: 'acc_test',
    createdBy: 'acc_manager',
    dueAt: '2026-10-05T22:30:00.000Z',
    dueOn: '2026-10-06',
    overdue: false,
    version: 1,
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  }) as Task;

const items = [
  task({}),
  task({
    taskId: 'task_000002',
    title: 'Send the brochure',
    dueAt: '2026-09-29T09:00:00.000Z',
    dueOn: '2026-09-29',
    overdue: true,
  }),
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z'));
  window.history.pushState({}, '', '/tasks');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const path = input.split('?')[0] ?? input;
      const routes: Record<string, unknown> = {
        '/api/v1/auth/refresh': { accessToken: 'access-token' },
        '/api/v1/me': session,
        '/api/v1/notifications/unread-count': { unread: 0 },
        '/api/v1/tasks': { items },
        '/api/v1/tasks/calendar': { items, truncated: false },
      };
      const body = routes[path];
      return Promise.resolve(body === undefined ? json({ error: {} }, 404) : json(body));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const renderApp = () =>
  render(
    <StrictMode>
      <App i18n={createI18n(() => undefined)} />
    </StrictMode>,
  );

// Compile and import the lazily loaded chunks once, before any test is timed.
beforeAll(warmLazyModules, WARM_UP_BUDGET_MS);

describe('tasks screen', () => {
  it('lists my tasks and names an overdue one in words', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'المهام' }, FIRST_RENDER);
    const row = (await screen.findByText('Send the brochure')).closest('tr, li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('متأخرة')).toBeTruthy();
    const onTime = (await screen.findByText('Call back the customer')).closest('tr, li');
    expect(within(onTime as HTMLElement).queryByText('متأخرة')).toBeNull();
    // Without task.view there is no "all in my scope" switch.
    expect(screen.queryByRole('button', { name: 'كل ما في نطاقي' })).toBeNull();
  });

  it('files tasks on the organization day in a Saturday-first calendar', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'المهام' }, FIRST_RENDER);
    fireEvent.click(screen.getByRole('tab', { name: 'التقويم' }));
    const grid = await screen.findByRole('grid');
    const saturday = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2026, 9, 3)));
    expect(within(grid).getAllByRole('columnheader')[0]?.textContent).toBe(saturday);

    // The task due 01:30 on the 6th (22:30 UTC on the 5th) sits in the 6th's cell.
    const cells = within(grid).getAllByRole('gridcell');
    const sixth = cells.find((cell) => cell.textContent?.startsWith('6') === true);
    expect(sixth?.textContent).toContain('Call back the customer');
    const today = cells.find((cell) => cell.getAttribute('aria-current') === 'date');
    expect(today?.textContent?.startsWith('1')).toBe(true);
  });
});
