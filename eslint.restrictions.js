// @ts-check
/**
 * Project-specific lint restrictions (PLAT-003, THEME-002, THEME-003, I18N-004). Kept separate from
 * eslint.config.js so tests/lint-rules.test.ts can prove each rule fires.
 */

const UI_SOURCE = ['apps/web/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'];
const TESTS = ['**/*.test.{ts,tsx}'];

/** THEME-003: colors come from tokens only. packages/ui/src/tokens.ts is the single exception. */
const colorLiterals = [
  {
    selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
    message: 'Color literal: use a theme token (THEME-003, ADR-0005).',
  },
  {
    selector: 'Literal[value=/\\b(rgba?|hsla?)\\s*\\(/]',
    message: 'Color function literal: use a theme token (THEME-003, ADR-0005).',
  },
  {
    selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?)\\s*\\(/]',
    message: 'Color literal in template: use a theme token (THEME-003, ADR-0005).',
  },
  {
    selector:
      'Property[key.name=/^(color|bgcolor|backgroundColor|borderColor|fill|stroke|outlineColor)$/][value.value=/^(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|navy|teal)$/i]',
    message: 'Named color: use a theme token (THEME-003, ADR-0005).',
  },
];

/** I18N-004: logical CSS properties only, so layouts mirror correctly in RTL. */
const physicalCss = [
  {
    selector: 'Property[key.name=/^(margin|padding|border)(Left|Right)/]',
    message:
      'Physical CSS property: use the logical equivalent, e.g. marginInlineStart (I18N-004).',
  },
  {
    selector: 'Property[key.value=/^(margin|padding|border)-(left|right)/]',
    message: 'Physical CSS property: use the logical equivalent (I18N-004).',
  },
  {
    selector: 'Property[key.name=/^(left|right|ml|mr|pl|pr)$/]',
    message:
      'Physical position or spacing: use insetInlineStart/End or marginInline*/paddingInline* (I18N-004).',
  },
  {
    selector: 'Property[key.name=/^(textAlign|float|clear)$/][value.value=/^(left|right)$/]',
    message: 'Physical alignment: use start/end (I18N-004).',
  },
  {
    selector:
      'TemplateElement[value.raw=/(margin|padding|border)-(left|right)\\s*:|text-align\\s*:\\s*(left|right)/]',
    message: 'Physical CSS in template: use logical properties (I18N-004).',
  },
];

/** THEME-002 / ADR-0004: one Light Mode theme; no dark mode, system mode, or theme switching. */
const lightModeOnly = [
  {
    selector: 'Literal[value=/prefers-color-scheme/]',
    message: 'Light Mode only: no prefers-color-scheme (THEME-002, ADR-0004).',
  },
  {
    selector: 'TemplateElement[value.raw=/prefers-color-scheme/]',
    message: 'Light Mode only: no prefers-color-scheme (THEME-002, ADR-0004).',
  },
  {
    selector: 'Property[key.name=/^(colorSchemes|colorSchemeSelector)$/]',
    message: 'Light Mode only: no color schemes (THEME-002, ADR-0004).',
  },
  {
    selector: "Property[key.name='mode'][value.value='dark']",
    message: 'Light Mode only: no dark palette (THEME-002, ADR-0004).',
  },
  {
    selector: "ImportSpecifier[imported.name='useColorScheme']",
    message: 'Light Mode only: no color scheme switching (THEME-002, ADR-0004).',
  },
];

/** No hard-coded user-facing text: JSX text and labelling attributes must come from translations. */
const hardCodedText = [
  {
    selector: 'JSXText[value=/[A-Za-z\\u0600-\\u06FF]/]',
    message: 'Hard-coded text in JSX: use a translation key (CLAUDE.md, I18N-002).',
  },
  {
    selector:
      "JSXAttribute[name.name=/^(aria-label|title|alt|placeholder|label|helperText)$/][value.type='Literal']",
    message: 'Hard-coded label: use a translation key (CLAUDE.md, I18N-002).',
  },
];

const SERVER_ONLY = [
  'mongoose',
  'ioredis',
  'bullmq',
  'express',
  'helmet',
  'cors',
  'pino',
  'pino-http',
  'rate-limiter-flexible',
  '@alola/config',
  '@alola/security',
];

const BROWSER_ONLY = ['react', 'react-dom', 'react-dom/*', '@mui/*', '@emotion/*', 'i18next'];

/**
 * Browser-only imports refused in server code. `@alola/ui` is matched by a regular expression rather
 * than a glob because of its one exception: `@alola/ui/brand`, the React-free brand rule, which lets the
 * API validate a deployment's colour with exactly the code the browser uses (THEME-013, ADR-0027).
 * `packages/ui/src/brand.test.ts` proves that entry imports nothing but tokens and contrast.
 */
const BROWSER_ONLY_PATTERNS = [
  { group: BROWSER_ONLY, message: 'Browser-only module imported into a server application.' },
  {
    regex: '^@alola/ui(?!/brand$)(/.*)?$',
    message: 'Browser-only module imported into a server application.',
  },
];

const publicEntryOnly = {
  group: ['@alola/*/src', '@alola/*/src/**', '**/packages/*/src/**'],
  message: 'Import a workspace package through its public entry point only (ADR-0001).',
};

/** @type {import('eslint').Linter.Config[]} */
export const restrictions = [
  {
    files: UI_SOURCE,
    ignores: ['packages/ui/src/tokens.ts', ...TESTS],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...colorLiterals,
        ...physicalCss,
        ...lightModeOnly,
        ...hardCodedText,
      ],
    },
  },
  {
    files: ['packages/ui/src/tokens.ts'],
    rules: { 'no-restricted-syntax': ['error', ...physicalCss, ...lightModeOnly] },
  },
  // PLAT-003 module boundaries.
  {
    files: ['**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [publicEntryOnly] }] },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicEntryOnly,
            {
              group: ['@alola/web', '@alola/api', '@alola/worker', '**/apps/**'],
              message: 'Packages must not depend on applications (ADR-0001).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicEntryOnly,
            { group: SERVER_ONLY, message: 'Server-only module imported into the browser app.' },
            { group: ['node:*'], message: 'Node built-in imported into the browser app.' },
            {
              group: ['@alola/api', '@alola/worker', '**/apps/api/**', '**/apps/worker/**'],
              message: 'Applications must not import each other.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicEntryOnly,
            ...BROWSER_ONLY_PATTERNS,
            {
              group: ['@alola/web', '**/apps/web/**'],
              message: 'Applications must not import each other.',
            },
          ],
        },
      ],
    },
  },
  // ADR-0001: a domain module is reached only through its published index.
  {
    files: ['apps/api/src/modules/*/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicEntryOnly,
            ...BROWSER_ONLY_PATTERNS,
            {
              regex: '^\\.\\./[^./][^/]*/(?!index(\\.ts)?$).+',
              message:
                'Import another module only through its index — never its internals (ADR-0001).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/modules/*/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            publicEntryOnly,
            ...BROWSER_ONLY_PATTERNS,
            {
              regex: '^\\.\\./\\.\\./[^./][^/]*/(?!index(\\.ts)?$).+',
              message:
                'Import another module only through its index — never its internals (ADR-0001).',
            },
          ],
        },
      ],
    },
  },
];
