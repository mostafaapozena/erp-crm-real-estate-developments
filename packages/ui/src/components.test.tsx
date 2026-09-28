import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Bell } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { DataTable, type DataColumn } from './DataTable';
import { Icon } from './Icon';
import { LtrIsolate } from './LtrIsolate';
import { StateView, type StateKind } from './StateView';
import {
  STATUS_ICONS,
  STATUS_PALETTE,
  StatusChip,
  visuallyHidden,
  type StatusTone,
} from './StatusChip';
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
  const kinds: StateKind[] = [
    'loading',
    'empty',
    'noResults',
    'error',
    'offline',
    'forbidden',
    'success',
    'notConnected',
    'simulated',
  ];

  for (const kind of kinds) {
    it(`renders the ${kind} state with text and an accessible role`, () => {
      render(
        <ThemeRoot locale="ar">
          <StateView kind={kind} title={`title-${kind}`} description={`desc-${kind}`} />
        </ThemeRoot>,
      );
      const region = screen.getByRole(kind === 'error' || kind === 'offline' ? 'alert' : 'status');
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

  /**
   * SD-23: identifiers are never reformatted or localized — they are displayed exactly as stored, with
   * Western digits, and isolated so their character order does not visibly reorder inside Arabic text.
   */
  describe.each([
    ['phone number', '+201001234567'],
    ['national ID', '29001011234567'],
    ['bank account number (IBAN)', 'EG380019000500000000263180002'],
    ['unit code', 'ALO-B3-07-1204'],
  ])('%s', (_label, value) => {
    it('renders verbatim with Western digits, isolated left-to-right', () => {
      render(<LtrIsolate>{value}</LtrIsolate>);
      const element = screen.getByText(value);
      expect(element.tagName).toBe('BDI');
      expect(element.getAttribute('dir')).toBe('ltr');
      // Exactly as supplied: no grouping separators inserted, no digit-shape conversion, order intact.
      expect(element.textContent).toBe(value);
      expect(element.textContent).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
    });
  });
});

describe('Icon (ADR-0030)', () => {
  it('is hidden from assistive technology unless it carries a label', () => {
    const { container } = render(<Icon icon={Bell} />);
    const wrapper = container.querySelector('[data-icon]');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper?.querySelector('svg')).not.toBeNull();
  });

  it('exposes a label as an image when the icon stands alone', () => {
    render(<Icon icon={Bell} label="notifications" />);
    expect(screen.getByRole('img', { name: 'notifications' })).toBeDefined();
  });
});

describe('StatusChip (WCAG 1.4.1)', () => {
  it('gives every tone its label and a distinct glyph', () => {
    const tones: StatusTone[] = ['neutral', 'info', 'success', 'warning', 'danger'];
    const glyphs = new Set(tones.map((tone) => STATUS_ICONS[tone]));
    expect(glyphs.size).toBe(tones.length);
    for (const tone of tones) {
      const { container, unmount } = render(<StatusChip tone={tone} label={`label-${tone}`} />);
      const chip = container.querySelector(`[data-tone="${tone}"]`);
      expect(chip?.textContent).toContain(`label-${tone}`);
      expect(chip?.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('uses only registered contrast pairs', () => {
    for (const { fg, bg } of Object.values(STATUS_PALETTE)) {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('visuallyHidden', () => {
  it('is one pixel, never a fraction of its parent (MUI reads width: 1 as 100%)', () => {
    expect(visuallyHidden.width).toBe('1px');
    expect(visuallyHidden.height).toBe('1px');
    expect(visuallyHidden.margin).toBe('-1px');
  });
});

describe('DataTable (THEME-010)', () => {
  const columns: DataColumn<{ id: string; name: string }>[] = [
    { key: 'name', header: 'Name', render: (row) => row.name },
  ];
  const labels = {
    loadingTitle: 'loading',
    emptyTitle: 'empty',
    noResultsTitle: 'no-results',
    errorTitle: 'error',
    forbiddenTitle: 'forbidden',
  };
  const base = { columns, rowKey: (row: { id: string }) => row.id, caption: 'people', labels };

  it('shows skeleton rows while loading, announced as busy', () => {
    render(<DataTable {...base} rows={[]} status="loading" />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('loading')).toBeDefined();
  });

  it('tells "nothing yet" apart from "nothing matches the filters"', () => {
    const { rerender } = render(<DataTable {...base} rows={[]} status="ready" />);
    expect(screen.getByText('empty')).toBeDefined();
    rerender(<DataTable {...base} rows={[]} status="ready" filtered />);
    expect(screen.getByText('no-results')).toBeDefined();
  });

  it('opens a row from the keyboard', () => {
    const opened: string[] = [];
    render(
      <DataTable
        {...base}
        rows={[{ id: 'a', name: 'Alpha' }]}
        status="ready"
        onRowClick={(row) => opened.push(row.id)}
        rowLabel={(row) => `open ${row.name}`}
      />,
    );
    const row = screen.getByLabelText('open Alpha');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(opened).toEqual(['a']);
  });
});
