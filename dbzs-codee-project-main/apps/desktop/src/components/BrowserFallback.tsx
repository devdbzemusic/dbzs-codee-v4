export function BrowserFallback() {
  return (
    <main className="grid min-h-screen place-items-center bg-dbzs-bg px-6 py-10 text-dbzs-text">
      <section className="w-full max-w-2xl border border-dbzs-border bg-dbzs-panel p-8 shadow-panel">
        <p className="text-xs uppercase tracking-wide text-dbzs-muted">Browser-Vorschau</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">DBZS Code Assistant</h1>
        <p className="mt-4 text-sm leading-6 text-dbzs-muted">
          DBZS Code Assistant läuft gerade im Browser-Modus.
          <br />
          Bitte über Electron starten: <code className="text-dbzs-cyan">pnpm dev</code>
        </p>
        <p className="mt-3 text-sm leading-6 text-dbzs-muted">
          Die Browser-Vorschau auf localhost:5173 enthält keine Electron-Bridge.
        </p>
      </section>
    </main>
  );
}
