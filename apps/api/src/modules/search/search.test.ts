import { ScopeAssignmentSchema, type ActorContext } from '@alola/contracts';
import { describe, expect, it, vi } from 'vitest';
import { SearchService, escapeSearchTerm, type SearchProvider } from './service';

const actor = (permissions: ActorContext['permissions']): ActorContext => ({
  accountId: 'acc_test01',
  kind: 'account',
  roleKeys: [],
  permissions,
  deniedPermissions: [],
  scope: ScopeAssignmentSchema.parse({ level: 'all' }),
  grantVersion: 0,
});

describe('SearchService (CORE-SEARCH-001)', () => {
  it('asks only the providers whose permission the actor holds', async () => {
    const leads = vi.fn(() =>
      Promise.resolve([{ type: 'lead' as const, id: 'lead_1', label: 'A' }]),
    );
    const units = vi.fn(() => Promise.resolve([]));
    const service = new SearchService({
      providers: [
        { type: 'lead', permission: 'crm.lead.view', search: leads },
        { type: 'unit', permission: 'inventory.unit.view', search: units },
      ],
    });
    const result = await service.search(actor(['crm.lead.view']), { q: 'Ah' });
    expect(result.searched).toEqual(['lead']);
    expect(units).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
  });

  it('keeps other answers when one provider fails, and caps each type', async () => {
    const warn = vi.fn();
    const many = Array.from({ length: 9 }, (_value, index) => ({
      type: 'customer' as const,
      id: `cust_${String(index)}`,
      label: 'C',
    }));
    const providers: SearchProvider[] = [
      { type: 'lead', search: () => Promise.reject(new Error('down')) },
      { type: 'customer', search: () => Promise.resolve(many) },
    ];
    const service = new SearchService({ providers, logger: { warn } as never });
    const result = await service.search(actor([]), { q: 'Ca' });
    expect(result.items).toHaveLength(5);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('refuses an unknown type', async () => {
    const service = new SearchService({ providers: [] });
    await expect(
      service.search(actor([]), { q: 'Ab', types: 'lead,salary' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('escapes every regular-expression metacharacter', () => {
    const escaped = escapeSearchTerm('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o');
    expect(new RegExp(`^${escaped}$`).test('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(true);
    expect(new RegExp(`^${escapeSearchTerm('.*')}`).test('anything')).toBe(false);
  });
});
