import Button from '@mui/material/Button';
import { StateView } from '@alola/ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a failure inside a lazily loaded route.
 *
 * The common cause is mundane: someone has a tab open from before the last deployment, the chunk file
 * names changed, and the import 404s. That is **recoverable** — reloading fixes it — so it renders a
 * retry rather than a blank page. A blank page for a fixable problem is how a click becomes a support
 * call.
 *
 * A class component because React still offers no hook for this; `key` is used by the caller to reset
 * the boundary when the route changes, so an error on one page does not persist onto the next.
 */
interface Props {
  children: ReactNode;
  title: string;
  description: string;
  retryLabel: string;
  /** Reported so a failure is visible in development rather than silently swallowed. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  failed: boolean;
}

export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private readonly retry = (): void => {
    // A failed dynamic import is cached by the browser, so re-rendering alone would fail again.
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <StateView
        kind="error"
        title={this.props.title}
        description={this.props.description}
        action={
          <Button variant="contained" onClick={this.retry}>
            {this.props.retryLabel}
          </Button>
        }
      />
    );
  }
}
