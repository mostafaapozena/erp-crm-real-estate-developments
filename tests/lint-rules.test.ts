import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { restrictions } from '../eslint.restrictions.js';

/**
 * Proves the project lint rules actually fire (PLAT-003, THEME-002, THEME-003, I18N-004). A rule that
 * silently matches nothing would pass every lint run while enforcing nothing.
 */
const root = fileURLToPath(new URL('..', import.meta.url));

const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
      },
    },
    ...restrictions,
  ],
});

async function messages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.message);
}

const WEB = 'apps/web/src/Fixture.tsx';

describe('THEME-003: no color literals outside tokens.ts', () => {
  it.each([
    ["const c = '#2563EB';", 'Color literal'],
    ["const s = { color: 'rgb(0, 0, 0)' };", 'Color function'],
    ['const b = `1px solid #fff`;', 'template'],
    ["const s = { bgcolor: 'white' };", 'Named color'],
  ])('rejects %s', async (code, fragment) => {
    expect((await messages(code, WEB)).join('\n')).toContain(fragment);
  });

  it('allows color values in packages/ui/src/tokens.ts only', async () => {
    expect(
      await messages("export const t = { primary: '#2563EB' };", 'packages/ui/src/tokens.ts'),
    ).toEqual([]);
    expect(await messages("export const t = '#2563EB';", 'packages/ui/src/Other.ts')).not.toEqual(
      [],
    );
  });

  it('allows anchors that are not colors', async () => {
    expect(await messages("const href = '#main';", WEB)).toEqual([]);
  });
});

describe('I18N-004: logical CSS only', () => {
  it.each([
    'const s = { marginLeft: 8 };',
    'const s = { paddingRight: 8 };',
    'const s = { left: 0 };',
    'const s = { ml: 2 };',
    "const s = { textAlign: 'right' };",
    "const s = { 'border-left': '1px' };",
  ])('rejects %s', async (code) => {
    expect((await messages(code, WEB)).join('\n')).toMatch(/Physical/);
  });

  it('allows logical properties', async () => {
    expect(
      await messages(
        "const s = { marginInlineStart: 8, insetInlineEnd: 0, textAlign: 'start' };",
        WEB,
      ),
    ).toEqual([]);
  });
});

describe('THEME-002: Light Mode only', () => {
  it.each([
    "const q = '@media (prefers-color-scheme: dark)';",
    'const t = { colorSchemes: {} };',
    "const p = { mode: 'dark' };",
    "import { useColorScheme } from '@mui/material/styles';",
  ])('rejects %s', async (code) => {
    expect((await messages(code, WEB)).join('\n')).toContain('Light Mode only');
  });
});

describe('no hard-coded user-facing text', () => {
  it.each([
    'const e = <p>Hello</p>;',
    'const e = <p>مرحبا</p>;',
    'const e = <button aria-label="Close" />;',
  ])('rejects %s', async (code) => {
    expect((await messages(code, WEB)).join('\n')).toContain('translation key');
  });

  it('allows translated text', async () => {
    expect(await messages("const e = <p aria-label={t('x')}>{t('y')}</p>;", WEB)).toEqual([]);
  });
});

describe('PLAT-003: module boundaries', () => {
  it('blocks deep imports into package internals', async () => {
    expect(
      (await messages("import { x } from '@alola/ui/src/theme';", 'apps/web/src/a.ts')).join(),
    ).toContain('public entry point');
  });

  it('blocks packages from importing applications', async () => {
    expect(
      (await messages("import { x } from '@alola/api';", 'packages/ui/src/a.ts')).join(),
    ).toContain('must not depend on applications');
  });

  it('blocks server libraries in the browser and browser libraries on the server', async () => {
    expect(
      (await messages("import mongoose from 'mongoose';", 'apps/web/src/a.ts')).join(),
    ).toContain('Server-only');
    expect((await messages("import React from 'react';", 'apps/api/src/a.ts')).join()).toContain(
      'Browser-only',
    );
  });

  it('allows icons in the browser only through the design system (ADR-0030)', async () => {
    for (const source of [
      "import { Bell } from 'lucide-react';",
      "import Bell from '@mui/icons-material/Notifications';",
      "import { FaBell } from 'react-icons/fa';",
    ]) {
      expect((await messages(source, 'apps/web/src/a.tsx')).join()).toContain('@alola/ui/icons');
    }
    expect(await messages("import { Bell } from '@alola/ui/icons';", 'apps/web/src/a.tsx')).toEqual(
      [],
    );
    // The design system itself is where the library is wrapped.
    expect(await messages("import { Bell } from 'lucide-react';", 'packages/ui/src/a.tsx')).toEqual(
      [],
    );
  });

  it('allows the server only the React-free brand rule from the design system', async () => {
    for (const file of ['apps/api/src/a.ts', 'apps/api/src/modules/company/service.ts']) {
      expect(await messages("import { validateBrandColor } from '@alola/ui/brand';", file)).toEqual(
        [],
      );
      expect((await messages("import { ThemeRoot } from '@alola/ui';", file)).join()).toContain(
        'Browser-only',
      );
      expect((await messages("import { x } from '@alola/ui/theme';", file)).join()).toContain(
        'Browser-only',
      );
    }
  });

  it("blocks a domain module from reaching into another module's internals", async () => {
    const file = 'apps/api/src/modules/sales/service.ts';
    expect((await messages("import { x } from '../inventory/repository';", file)).join()).toContain(
      'through its index',
    );
    expect(await messages("import { x } from '../inventory';", file)).toEqual([]);
    expect(await messages("import { x } from '../inventory/index';", file)).toEqual([]);
    expect(await messages("import { x } from './repository';", file)).toEqual([]);
  });

  it('applies the same rule to nested files within a module', async () => {
    const file = 'apps/api/src/modules/sales/quotes/pricing.ts';
    expect((await messages("import { x } from '../../inventory/model';", file)).join()).toContain(
      'through its index',
    );
    expect(await messages("import { x } from '../shared/helpers';", file)).toEqual([]);
  });
});
