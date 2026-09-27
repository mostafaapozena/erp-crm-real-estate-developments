import { useTheme } from '@mui/material/styles';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeRoot } from './ThemeRoot';
import { tokens } from './tokens';

function PrimaryProbe() {
  const theme = useTheme();
  return <span data-testid="primary">{theme.palette.primary.main}</span>;
}

afterEach(cleanup);

/** THEME-013: the theme renders a deployment's validated colour, and nothing unvalidated. */
describe('ThemeRoot brand colour', () => {
  it('uses the approved primary when nothing is configured', () => {
    render(
      <ThemeRoot locale="ar">
        <PrimaryProbe />
      </ThemeRoot>,
    );
    expect(screen.getByTestId('primary').textContent).toBe(tokens.primary);
  });

  it('uses a configured colour that passes every contrast pair', () => {
    render(
      <ThemeRoot locale="en" brandPrimary="#0F766E">
        <PrimaryProbe />
      </ThemeRoot>,
    );
    expect(screen.getByTestId('primary').textContent).toBe('#0F766E');
  });

  it('ignores a colour that fails contrast, whatever the server sent', () => {
    render(
      <ThemeRoot locale="en" brandPrimary="#FACC15">
        <PrimaryProbe />
      </ThemeRoot>,
    );
    expect(screen.getByTestId('primary').textContent).toBe(tokens.primary);
  });
});
