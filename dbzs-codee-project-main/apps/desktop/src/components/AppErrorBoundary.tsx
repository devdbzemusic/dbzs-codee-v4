import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[DBZS] Renderer error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="grid min-h-screen place-items-center bg-[#070b10] px-6 py-10 text-[#e8f0f7]">
          <section className="w-full max-w-2xl border border-[#223140] bg-[#0d141c] p-8">
            <p className="text-xs uppercase tracking-wide text-[#89a1b4]">Renderer-Fehler</p>
            <h1 className="mt-2 text-xl font-semibold">Die Oberfläche konnte nicht geladen werden</h1>
            <p className="mt-3 text-sm text-[#89a1b4]">
              Öffne die Entwicklertools (Strg+Shift+I) für Details oder starte die App neu.
            </p>
            <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words border border-[#223140] bg-[#070b10] p-3 text-xs text-[#ff6b6b]">
              {this.state.error.message}
            </pre>
            <button
              className="mt-4 border border-[#21d6c7]/50 bg-[#21d6c7]/10 px-4 py-2 text-sm text-[#21d6c7]"
              onClick={() => window.location.reload()}
              type="button"
            >
              Neu laden
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
