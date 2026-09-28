import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { CHART_SERIES_ORDER, LtrIsolate, elevation, tokens, visuallyHidden } from '@alola/ui';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * The product's charts (ADR-0030), drawn with `recharts` and nothing else.
 *
 * Every chart here obeys the same rules:
 *
 * - **Real data only.** A chart draws exactly the numbers it is given; nothing is interpolated,
 *   smoothed, projected or trended. An empty dataset renders the caller's empty message instead of
 *   an empty frame.
 * - **Not colour alone (THEME-009).** Every mark is labelled with its category and its formatted
 *   value, on the chart or in the legend beside it. Colours come from `CHART_SERIES_ORDER`.
 * - **An alternative for assistive technology.** Each chart is a `<figure>` whose SVG is hidden from
 *   screen readers and whose numbers are repeated in a visually hidden `<table>` — the same values,
 *   in reading order.
 * - **Direction-aware.** In Arabic the category axis starts at the right: a horizontal chart's value
 *   axis is reversed and its label axis sits on the right.
 * - **Honest axes.** Value axes start at zero.
 */
export interface ChartDatum {
  key: string;
  label: string;
  value: number;
  /** The value as the reader should see it — already formatted (money, count, percentage). */
  display: string;
}

interface ChartFrameProps {
  caption: string;
  data: ChartDatum[];
  headers: { category: string; value: string };
  emptyLabel: string;
  height: number;
  children: ReactNode;
}

const colourAt = (index: number) =>
  tokens[CHART_SERIES_ORDER[index % CHART_SERIES_ORDER.length] ?? 'chart1'];

/** ResizeObserver is what sizes a responsive chart; without it (jsdom), the table stands alone. */
const canMeasure = () => typeof window !== 'undefined' && 'ResizeObserver' in window;

function ChartFrame({ caption, data, headers, emptyLabel, height, children }: ChartFrameProps) {
  const hasData = data.some((datum) => datum.value > 0);
  if (!hasData) {
    return (
      <Typography variant="body2" color="text.secondary" component="p" sx={{ paddingBlock: 3 }}>
        {emptyLabel}
      </Typography>
    );
  }
  return (
    <Box component="figure" sx={{ margin: 0, minWidth: 0 }} data-chart={caption}>
      {canMeasure() ? (
        <Box aria-hidden sx={{ inlineSize: '100%', blockSize: height, minWidth: 0 }}>
          {children}
        </Box>
      ) : null}
      <Box
        component="table"
        sx={canMeasure() ? visuallyHidden : { inlineSize: '100%', borderCollapse: 'collapse' }}
      >
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{headers.category}</th>
            <th scope="col">{headers.value}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key}>
              <th scope="row">{datum.label}</th>
              <td>
                <LtrIsolate>{datum.display}</LtrIsolate>
              </td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: ChartDatum }[];
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: tokens.borderSoft,
        borderRadius: 1.5,
        boxShadow: elevation.overlay,
        paddingInline: 1.5,
        paddingBlock: 1,
      }}
    >
      <Typography variant="caption" color="text.secondary" component="p">
        {datum.label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 700 }} component="p">
        <LtrIsolate>{datum.display}</LtrIsolate>
      </Typography>
    </Box>
  );
}

const tickStyle = { fill: tokens.secondaryText, fontSize: 12, fontFamily: 'inherit' };

export interface BarChartProps {
  caption: string;
  data: ChartDatum[];
  headers: { category: string; value: string };
  emptyLabel: string;
  /** `horizontal` for word categories (stages, sources); `columns` for ordered buckets. */
  orientation?: 'horizontal' | 'columns';
  /** One colour per bar instead of the series colour — for categories that are different things. */
  multicolour?: boolean;
  height?: number;
}

export function CategoryBarChart({
  caption,
  data,
  headers,
  emptyLabel,
  orientation = 'horizontal',
  multicolour = false,
  height,
}: BarChartProps) {
  const theme = useTheme();
  const rtl = theme.direction === 'rtl';
  const horizontal = orientation === 'horizontal';
  const size = height ?? (horizontal ? Math.max(160, data.length * 40 + 24) : 240);
  const longest = data.reduce((max, datum) => Math.max(max, datum.label.length), 0);
  const labelWidth = Math.min(160, Math.max(64, longest * 7.5));

  return (
    <ChartFrame
      caption={caption}
      data={data}
      headers={headers}
      emptyLabel={emptyLabel}
      height={size}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          // Symmetric side margins are recharts' default, so only the block margins are set here.
          margin={{ top: 8, bottom: 4 }}
          barCategoryGap={horizontal ? 10 : '28%'}
          accessibilityLayer={false}
        >
          <CartesianGrid
            stroke={tokens.borderSoft}
            strokeDasharray="3 3"
            horizontal={!horizontal}
            vertical={horizontal}
          />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                reversed={rtl}
                domain={[0, 'auto']}
                allowDecimals={false}
                tick={tickStyle}
                axisLine={false}
                tickLine={false}
                hide
              />
              <YAxis
                type="category"
                dataKey="label"
                orientation={rtl ? 'right' : 'left'}
                width={labelWidth}
                tick={tickStyle}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
            </>
          ) : (
            <>
              <XAxis
                type="category"
                dataKey="label"
                reversed={rtl}
                tick={tickStyle}
                axisLine={{ stroke: tokens.borderSubtle }}
                tickLine={false}
                interval={0}
              />
              <YAxis
                type="number"
                orientation={rtl ? 'right' : 'left'}
                domain={[0, 'auto']}
                allowDecimals={false}
                tick={tickStyle}
                axisLine={false}
                tickLine={false}
                width={40}
              />
            </>
          )}
          <Tooltip
            cursor={{ fill: tokens.neutralSoft }}
            content={(props) => (
              <ChartTooltip
                {...(props.active !== undefined ? { active: props.active } : {})}
                payload={props.payload}
              />
            )}
          />
          <Bar
            dataKey="value"
            fill={tokens.chart1}
            radius={horizontal ? [4, 4, 4, 4] : [4, 4, 0, 0]}
            maxBarSize={horizontal ? 22 : 48}
            isAnimationActive={false}
          >
            {multicolour
              ? data.map((datum, index) => <Cell key={datum.key} fill={colourAt(index)} />)
              : null}
            <LabelList
              dataKey="display"
              position={horizontal ? (rtl ? 'left' : 'right') : 'top'}
              style={{
                fill: tokens.mainText,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface DonutChartProps {
  caption: string;
  data: ChartDatum[];
  headers: { category: string; value: string };
  emptyLabel: string;
  /** The figure in the centre, already formatted, and what it counts. */
  centre: { value: string; label: string };
}

/**
 * Parts of a whole. The legend beside the ring carries each part's label, value and share, so the
 * ring is a picture of the legend — never the only place a number lives.
 */
export function DonutChart({ caption, data, headers, emptyLabel, centre }: DonutChartProps) {
  const total = data.reduce((sum, datum) => sum + datum.value, 0);
  const parts = data.filter((datum) => datum.value > 0);
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        alignItems: 'center',
        gridTemplateColumns: { xs: '1fr', sm: 'minmax(160px, 200px) 1fr' },
      }}
    >
      <Box sx={{ position: 'relative', minWidth: 0 }}>
        <ChartFrame
          caption={caption}
          data={data}
          headers={headers}
          emptyLabel={emptyLabel}
          height={190}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart accessibilityLayer={false}>
              <Pie
                data={parts}
                dataKey="value"
                nameKey="label"
                innerRadius="64%"
                outerRadius="96%"
                paddingAngle={parts.length > 1 ? 2 : 0}
                stroke={tokens.surface}
                strokeWidth={2}
                isAnimationActive={false}
              >
                {parts.map((datum) => (
                  <Cell key={datum.key} fill={colourAt(data.indexOf(datum))} />
                ))}
              </Pie>
              <Tooltip
                content={(props) => (
                  <ChartTooltip
                    {...(props.active !== undefined ? { active: props.active } : {})}
                    payload={props.payload}
                  />
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartFrame>
        {total > 0 && canMeasure() ? (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              insetBlockStart: 0,
              insetInline: 0,
              blockSize: 190,
              display: 'grid',
              placeContent: 'center',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography sx={{ fontWeight: 700, fontSize: '1.375rem', lineHeight: 1.1 }}>
              <LtrIsolate>{centre.value}</LtrIsolate>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {centre.label}
            </Typography>
          </Box>
        ) : null}
      </Box>
      {total > 0 ? (
        <Box
          component="ul"
          sx={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 1 }}
        >
          {data.map((datum, index) => (
            <Box
              component="li"
              key={datum.key}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}
            >
              <Box
                aria-hidden
                sx={{
                  inlineSize: 10,
                  blockSize: 10,
                  borderRadius: '3px',
                  flexShrink: 0,
                  backgroundColor: colourAt(index),
                }}
              />
              <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                {datum.label}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                <LtrIsolate>{datum.display}</LtrIsolate>
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ minInlineSize: 40, textAlign: 'end' }}
              >
                <LtrIsolate>{`${Math.round((datum.value / total) * 100)}%`}</LtrIsolate>
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
