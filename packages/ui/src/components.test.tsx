import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LtrIsolate } from './LtrIsolate';
import { StateView, type StateKind } from './StateView';
import { ThemeRoot } from './ThemeRoot';
import { createAppTheme } from './theme';
import { tokens } from './tokens';

afterEach(cleanup);

describe('theme (THEME-001, THEME-002)', () => {
  it('is Light Mode only, built from the approved tokens', () => {
    const theme = createAppTheme('ar');
    expect(theme.palette.mode).toBe('light');
    expect(theme.palette.primary.main).toBe(tokens.primary);
    expect(theme.palette.primary.dark).toBe(tokens.primaryHover);
    expect(theme.palette.primary.contrastText).toBe(tokens.onPrimary);
    expect(theme.palette.background.default).toBe(tokens.pageBackground);
    expect(theme.palette.text.primary).toBe(tokens.mainText);
    expect(
      (theme as { colorSchemes?: Record<string, unknown> }).colorSchemes?.['dark'],
    ).toBeUndefined();
  });

  it('derives direction and font from the locale', () => {
    const ar = createAppTheme('ar');
    const en = createAppTheme('en');
    expect(ar.direction).toBe('rtl');
    expect(en.direction).toBe('ltr');
    expect(ar.typography.fontFamily).toContain('Alexandria');
    expect(en.typography.fontFamily).toContain('Inter');
  });
});

describe('StateView (THEME-010)', () => {
  const kinds: StateKind[] = ['loading', 'empty', 'error', 'forbidden', 'success'];

  for (const kind of kinds) {
    it(`renders the ${kind} state with text and an accessible role`, () => {
      render(
        <ThemeRoot locale="ar">
          <StateView kind={kind} title={`title-${kind}`} description={`desc-${kind}`} />
        </ThemeRoot>,
      );
      const region = screen.getByRole(kind === 'error' ? 'alert' : 'status');
      expect(region).toHaveProperty('dataset.state', kind);
      expect(screen.getByText(`title-${kind}`)).toBeDefined();
      expect(screen.getByText(`desc-${kind}`)).toBeDefined();
      // An icon or progress indicator accompanies the text: color is never the only signal.
      expect(region.querySelector('svg')).not.toBeNull();
    });
  }

  it('marks loading as busy', () => {
    render(<StateView kind="loading" title="t" />);
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });
});

describe('LtrIsolate (I18N-005)', () => {
  it('isolates left-to-right content', () => {
    render(<LtrIsolate>+201001234567</LtrIsolate>);
    const element = screen.getByText('+201001234567');
    expect(element.tagName).toBe('BDI');
    expect(element.getAttribute('dir')).toBe('ltr');
  });
});
