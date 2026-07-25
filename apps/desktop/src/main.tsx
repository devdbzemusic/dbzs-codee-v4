import React from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { readStandaloneView } from "@/utils/standaloneView";
import { SplashScreen } from "@/splash/SplashScreen";
import { App } from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

function removeBootSplash(): void {
  document.getElementById("dbzs-boot-splash")?.remove();
}

if (!rootElement) {
  throw new Error("Root element #root not found");
}

// The splash window must never mount <App/> — App.tsx's own effects fire
// backend-dependent loaders unconditionally on mount, which would race the
// backend boot sequence the splash exists to make honest. Branching here
// (two separate component trees) also avoids any Rules-of-Hooks concerns
// a conditional render inside a single component would raise.
const isSplashView = readStandaloneView() === "splash";

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>{isSplashView ? <SplashScreen /> : <App />}</AppErrorBoundary>
  </React.StrictMode>
);

removeBootSplash();

if (!isSplashView) {
  // Double rAF: the first callback fires before the browser has painted the
  // frame containing this render; the second fires only after that paint
  // has actually happened. This is the real "main-window-rendered" boot
  // phase's paint acknowledgement -- gating the splash's close on Electron's
  // built-in "ready-to-show" event alone (windowCoordinator.ts) only proves
  // the OS considers the window presentable, not that React has painted a
  // real first frame into it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void window.dbzs.reportBootPhaseState?.(
        "main-window-rendered",
        "success",
        "Hauptfenster vollständig gerendert."
      );
    });
  });
}
