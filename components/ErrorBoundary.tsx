import React from 'react';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; }

// App-wide error boundary. Without it, a single render throw anywhere below
// (a malformed realtime payload, an unexpected null in any modal, a bad decrypt)
// unmounts the WHOLE React tree and leaves a blank white screen with no recovery.
// Catch it here and show a recoverable "reload" fallback instead.
// (React error boundaries MUST be class components — there is no hook equivalent.)
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Console for now; a monitoring sink (Sentry / first-party edge fn) can hook
    // in here later without touching call sites.
    console.error('Render error caught by ErrorBoundary:', error, info);
  }

  private handleReload = () => { window.location.reload(); };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-2xl">⚠️</div>
          <h1 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Something went wrong</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">The app hit an unexpected error. Reloading usually fixes it.</p>
          <button
            onClick={this.handleReload}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition active:scale-95"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
