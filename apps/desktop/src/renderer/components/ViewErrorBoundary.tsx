import React from "react";
import { Button, ErrorState } from "./ui/kit";

// One failing view must never take the window down with it. Without this, an
// error thrown while a view renders unmounts the whole app: no sidebar, no way
// to leave (docs/ui-audit/REPORT.md, X4). The shell wraps the active view in
// this boundary, keyed by the view, so switching views starts it fresh.

export interface ViewErrorBoundaryProps {
  /** The view's name as the sidebar shows it. */
  viewLabel: string;
  children: React.ReactNode;
  /** Leave for a view that works (the shell passes "go to Command"). */
  onLeave?: () => void;
}

interface ViewErrorBoundaryState {
  error: Error | null;
}

export class ViewErrorBoundary extends React.Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ViewErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Local only: the console of this window. Nothing is sent anywhere.
    console.error(`[DexNest] the ${this.props.viewLabel} view stopped working`, error, info.componentStack);
  }

  retry = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorState
        title={`${this.props.viewLabel} stopped working`}
        message="The rest of DexNest is fine. Try the view again, or go somewhere else and come back."
        detail={error.message || error.name}
        onRetry={this.retry}
        actions={this.props.onLeave && <Button variant="ghost" size="sm" onClick={this.props.onLeave}>Go to Command</Button>}
      />
    );
  }
}
