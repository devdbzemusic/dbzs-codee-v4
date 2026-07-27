import type * as Monaco from "monaco-editor";

type MonacoWorkerEnvironment = {
  getWorker: (_workerId: string, label: string) => Worker;
};

let configurePromise: Promise<void> | null = null;

async function configureMonaco(): Promise<void> {
  const [{ loader }, monaco, EditorWorker, JsonWorker, CssWorker, HtmlWorker, TsWorker] = await Promise.all([
    import("@monaco-editor/react"),
    import("monaco-editor"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    import("monaco-editor/esm/vs/language/json/json.worker?worker"),
    import("monaco-editor/esm/vs/language/css/css.worker?worker"),
    import("monaco-editor/esm/vs/language/html/html.worker?worker"),
    import("monaco-editor/esm/vs/language/typescript/ts.worker?worker")
  ]);

  const workerEnvironment: MonacoWorkerEnvironment = {
    getWorker: (_workerId, label) => {
      if (label === "json") {
        return new JsonWorker.default();
      }

      if (label === "css" || label === "scss" || label === "less") {
        return new CssWorker.default();
      }

      if (label === "html" || label === "handlebars" || label === "razor") {
        return new HtmlWorker.default();
      }

      if (label === "typescript" || label === "javascript") {
        return new TsWorker.default();
      }

      return new EditorWorker.default();
    }
  };

  (globalThis as typeof globalThis & { MonacoEnvironment?: MonacoWorkerEnvironment }).MonacoEnvironment =
    workerEnvironment;

  loader.config({ monaco: monaco as typeof Monaco });
}

export function ensureMonacoConfigured(): Promise<void> {
  if (!configurePromise) {
    configurePromise = configureMonaco();
  }

  return configurePromise;
}

export function resetMonacoConfigurationForTests(): void {
  configurePromise = null;
}
