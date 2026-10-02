import { ADMINISTRATIVE_PERMISSIONS, PERMISSIONS, type Permission } from '@alola/contracts';
import { describe, expect, it } from 'vitest';
import { BMP1_ADDITIONS, DEMO_ROLES } from './roles';

/**
 * The demonstration role matrix for BMP-1 (package 8). Demonstration configuration, not `SD-02` —
 * but the separations it demonstrates are pinned, because a demonstration that quietly gave every role
 * every permission would prove nothing about authorization.
 */
const role = (key: string) => {
  const found = DEMO_ROLES.find((entry) => entry.key === key);
  if (!found) throw new Error(`no role ${key}`);
  return found;
};
const holds = (key: string, permission: Permission) => role(key).permissions.includes(permission);

const COMMIT_ACTIONS: Permission[] = [
  'sales.contract.activate',
  'sales.contract.cancel',
  'sales.contract.amend',
  'sales.contract.sign',
];
const WRITE_PREFIXES = [
  'manage',
  'create',
  'edit',
  'assign',
  'convert',
  'activate',
  'cancel',
  'confirm',
];

describe('demonstration role matrix (BMP-1)', () => {
  it('names only catalogued permissions, each once per role', () => {
    for (const entry of DEMO_ROLES) {
      for (const permission of entry.permissions) expect(PERMISSIONS).toContain(permission);
      expect(new Set(entry.permissions).size).toBe(entry.permissions.length);
    }
    for (const key of Object.keys(BMP1_ADDITIONS))
      expect(DEMO_ROLES.map((entry) => entry.key)).toContain(key);
  });

  it('gives every BMP-1 addition to the role it names', () => {
    for (const [key, additions] of Object.entries(BMP1_ADDITIONS)) {
      for (const permission of additions) expect(holds(key, permission)).toBe(true);
    }
  });

  it('lets the manager commit a contract and the representative only raise one', () => {
    for (const permission of COMMIT_ACTIONS) {
      expect(holds('demo-sales-manager', permission)).toBe(true);
      expect(holds('demo-sales-representative', permission)).toBe(false);
    }
    expect(holds('demo-sales-representative', 'sales.reservation.create')).toBe(true);
    expect(holds('demo-sales-representative', 'sales.quotation.manage')).toBe(true);
    expect(holds('demo-sales-representative', 'sales.reservation.confirm')).toBe(false);
  });

  it('shows identity documents to the manager only among the sales roles', () => {
    expect(holds('demo-sales-manager', 'crm.customer.viewIdentity')).toBe(true);
    expect(holds('demo-sales-representative', 'crm.customer.viewIdentity')).toBe(false);
    expect(holds('demo-executive', 'crm.customer.viewIdentity')).toBe(false);
  });

  it('keeps configuration administrative and with the administrator', () => {
    for (const permission of ['settings.manage', 'numbering.manage'] as Permission[]) {
      expect(ADMINISTRATIVE_PERMISSIONS).toContain(permission);
      const holders = DEMO_ROLES.filter((entry) => entry.permissions.includes(permission)).map(
        (entry) => entry.key,
      );
      expect(holders).toEqual(['demo-system-administrator']);
    }
    // Only the administrator carries anything administrative — the one role with a second factor.
    for (const entry of DEMO_ROLES) {
      const administrative = entry.permissions.filter((permission) =>
        ADMINISTRATIVE_PERMISSIONS.includes(permission),
      );
      if (entry.key !== 'demo-system-administrator') expect(administrative).toEqual([]);
    }
  });

  it('leaves the executive read-only', () => {
    const writes = role('demo-executive').permissions.filter((permission) =>
      WRITE_PREFIXES.some((verb) => permission.endsWith(`.${verb}`)),
    );
    expect(writes).toEqual([]);
  });

  it('keeps the sales roles branch-scoped, and no role holds every permission', () => {
    expect(role('demo-sales-manager').scope).toBe('branch');
    expect(role('demo-sales-representative').scope).toBe('branch');
    for (const entry of DEMO_ROLES)
      expect(entry.permissions.length).toBeLessThan(PERMISSIONS.length);
  });
});
