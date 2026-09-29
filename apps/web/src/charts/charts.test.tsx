import { ThemeRoot } from '@alola/ui';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CategoryBarChart, DonutChart } from './index';
import { RatioMeter } from './RatioMeter';
import { FIRST_RENDER, WARM_UP_BUDGET_MS, warmLazyModules } from '../testing/warm-up';

/**
 * THEME-009: a series is never told apart by colour alone. Every bar carries its label and its
 * formatted value in text; a chart that cannot draw (no ResizeObserver, as in jsdom) still presents
 * its numbers as a table.
 */
afterEach(cleanup);

const data = [
  { key: 'new', label: 'جديد', value: 3, display: '3' },
  { key: 'won', label: 'تم البيع', value: 1, display: '1' },
];

// Compile and import the lazily loaded chunks once, before any test is timed.
beforeAll(warmLazyModules, WARM_UP_BUDGET_MS);

describe('charts (THEME-009)', () => {
  it('labels every horizontal bar with its category and value', () => {
    render(
      <ThemeRoot locale="ar">
        <CategoryBarChart
          caption="المسار"
          data={data}
          headers={{ category: 'المرحلة', value: 'العدد' }}
          emptyLabel="لا بيانات"
        />
      </ThemeRoot>,
    );
    const chart = screen.getByLabelText('المسار');
    expect(chart.tagName).toBe('DL');
    const terms = within(chart)
      .getAllByRole('term')
      .map((term) => term.textContent);
    const values = within(chart)
      .getAllByRole('definition')
      .map((value) => value.textContent);
    expect(terms).toEqual(['جديد', 'تم البيع']);
    expect(values).toEqual(['3', '1']);
  });

  it('shows the empty message instead of an empty frame', () => {
    render(
      <ThemeRoot locale="en">
        <CategoryBarChart
          caption="Pipeline"
          data={[{ key: 'x', label: 'X', value: 0, display: '0' }]}
          headers={{ category: 'Stage', value: 'Count' }}
          emptyLabel="Nothing yet"
        />
      </ThemeRoot>,
    );
    expect(screen.getByText('Nothing yet')).toBeDefined();
  });

  it('presents a donut as a data table where it cannot draw', async () => {
    render(
      <ThemeRoot locale="en">
        <DonutChart
          caption="Units by status"
          data={data.map((datum) => ({ ...datum, label: datum.key }))}
          headers={{ category: 'Status', value: 'Count' }}
          emptyLabel="Nothing yet"
          centre={{ value: '4', label: 'Units' }}
        />
      </ThemeRoot>,
    );
    const table = await screen.findByRole('table', { name: 'Units by status' }, FIRST_RENDER);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('exposes a ratio as a labelled progress bar with its value in words', () => {
    render(<RatioMeter label="Collected" value={0.2462} display="24.62%" />);
    const meter = screen.getByRole('progressbar', { name: 'Collected' });
    expect(meter.getAttribute('aria-valuenow')).toBe('25');
    expect(meter.getAttribute('aria-valuetext')).toBe('24.62%');
  });
});
