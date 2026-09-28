import type { Permission } from '@alola/contracts';
import { describe, expect, it } from 'vitest';
import { initialsOf } from '../branding';
import { NAVIGATION, activeItem, breadcrumbFor, visibleGroups } from './navigation';

const holding =
  (...held: Permission[]) =>
  (wanted: readonly Permission[]) =>
    wanted.some((permission) => held.includes(permission));

describe('navigation model', () => {
  it('points every entry at a distinct route', () => {
    const paths = NAVIGATION.flatMap((group) => group.items.map((item) => item.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('shows only the groups the actor can use, and never an empty group', () => {
    const groups = visibleGroups(holding('crm.lead.view'));
    expect(groups.map((group) => group.id)).toEqual(['overview', 'crm']);
    expect(groups.find((group) => group.id === 'crm')?.items.map((item) => item.path)).toEqual([
      '/leads',
    ]);
  });

  it('offers Company identity only with the profile permission', () => {
    expect(visibleGroups(holding()).some((group) => group.id === 'settings')).toBe(false);
    expect(
      visibleGroups(holding('company.profile.view')).some((group) => group.id === 'settings'),
    ).toBe(true);
  });

  it('marks the owning entry active for a detail or creation screen', () => {
    expect(activeItem('/contracts/abc')?.path).toBe('/contracts');
    expect(activeItem('/reservations/new')?.path).toBe('/reservations');
    expect(activeItem('/settings/company')?.path).toBe('/settings/company');
    expect(activeItem('/')?.path).toBe('/');
    // A prefix that is not a path segment does not match.
    expect(activeItem('/unitsx')).toBeUndefined();
  });

  it('builds the breadcrumb from the navigation model', () => {
    expect(breadcrumbFor('/').map((item) => item.path)).toEqual(['/']);
    expect(breadcrumbFor('/contracts/abc').map((item) => item.path)).toEqual(['/', '/contracts']);
    expect(breadcrumbFor('/settings/company').map((item) => item.path)).toEqual([
      '/',
      '/settings/company',
    ]);
  });
});

describe('initials', () => {
  it('draws initials from Arabic and English names', () => {
    expect(initialsOf('منى عبد الرحمن')).toBe('مع');
    expect(initialsOf('شركة العلا للتطوير العقاري').slice(0, 1)).toBe('ع');
    expect(initialsOf('ALOLA Developments')).toBe('AD');
    expect(initialsOf('')).toBe('');
  });
});
