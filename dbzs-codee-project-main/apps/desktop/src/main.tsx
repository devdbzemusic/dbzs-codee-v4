import React from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { App } from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

function removeBootSplash(): void {
  document.getElementById("dbzs-boot-splash")?.remove();
}

if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

removeBootSplash();
