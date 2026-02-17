"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Section label for the fallback message */
  sectionName: string;
  /** Optional custom fallback */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary for dashboard sections. Catches render and effect errors
 * (e.g. failed server action in child) and shows a graceful message so the
 * rest of the dashboard still renders.
 */
export default class DashboardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (typeof console !== "undefined" && console.error) {
      console.error(`[DashboardErrorBoundary ${this.props.sectionName}]`, error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-6 dark:border-amber-800/50 dark:bg-amber-950/30"
          role="alert"
        >
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {this.props.sectionName}
          </p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            Data temporarily unavailable. Please try again in a moment.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
