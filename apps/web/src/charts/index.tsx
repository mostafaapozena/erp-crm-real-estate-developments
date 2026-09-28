import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { Suspense, lazy, type ComponentProps } from 'react';
import { HorizontalBars } from './HorizontalBars';

/**
 * The chart components, loaded on demand (ADR-0030).
 *
 * `recharts` is the heaviest thing any screen imports, so it is never part of a route's own chunk:
 * a screen renders its headings, figures and lists at once, and each chart fills in when the
 * lazily loaded chart chunk arrives, holding a skeleton of the same height meanwhile.
 */
export type { ChartDatum } from './Charts';
export { RatioMeter } from './RatioMeter';

const LazyCategoryBarChart = lazy(() =>
  import('./Charts').then((module) => ({ default: module.CategoryBarChart })),
);
const LazyDonutChart = lazy(() =>
  import('./Charts').then((module) => ({ default: module.DonutChart })),
);

export function ChartSkeleton({ height = 160 }: { height?: number }) {
  return (
    <Box aria-hidden sx={{ display: 'grid', gap: 1.5, paddingBlock: 1, minBlockSize: height }}>
      {[72, 56, 88, 40].map((width) => (
        <Skeleton key={width} variant="rounded" height={18} sx={{ inlineSize: `${width}%` }} />
      ))}
    </Box>
  );
}

/**
 * Word categories render as layout-drawn horizontal bars (`HorizontalBars`), which mirror correctly
 * in RTL and need no chart chunk; ordered buckets (`orientation="columns"`) use recharts.
 */
export function CategoryBarChart(props: ComponentProps<typeof LazyCategoryBarChart>) {
  if ((props.orientation ?? 'horizontal') === 'horizontal') {
    return (
      <HorizontalBars
        caption={props.caption}
        data={props.data}
        emptyLabel={props.emptyLabel}
        {...(props.multicolour ? { multicolour: true } : {})}
      />
    );
  }
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <LazyCategoryBarChart {...props} />
    </Suspense>
  );
}

export function DonutChart(props: ComponentProps<typeof LazyDonutChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={190} />}>
      <LazyDonutChart {...props} />
    </Suspense>
  );
}
