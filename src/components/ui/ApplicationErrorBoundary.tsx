import { Component, type ReactNode } from 'react';

/** Fixed, projection-safe fallback: never render error messages or component data. */
export class ApplicationErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  declare props: { children: ReactNode };
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <section role="alert" className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-bold">頁面暫時無法顯示</h1>
          <p>請重新載入頁面。若問題持續，請聯絡管理員。</p>
          <button type="button" className="rounded-xl bg-slate-900 px-5 py-3 text-white" onClick={() => window.location.reload()}>重新載入</button>
        </section>
      </main>
    );
    return this.props.children;
  }
}
