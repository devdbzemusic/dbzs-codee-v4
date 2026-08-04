import type { ReactNode } from "react";

export function NeuralWorkbenchShell({
  header,
  rail,
  workspace,
  primary,
  inspector,
  dock,
  statusBar,
  leftWidth,
  rightWidth
}: {
  header: ReactNode;
  rail: ReactNode;
  workspace: ReactNode;
  primary: ReactNode;
  inspector: ReactNode;
  dock: ReactNode;
  statusBar: ReactNode;
  leftWidth: number;
  rightWidth: number;
}) {
  return (
    <main
      className="dbzs-workbench"
      style={{
        "--dbzs-workbench-left-width": `${leftWidth}px`,
        "--dbzs-workbench-right-width": `${rightWidth}px`
      } as React.CSSProperties}
    >
      {header}
      <section className="dbzs-workbench__body">
        {rail}
        <aside className="dbzs-workbench__workspace">{workspace}</aside>
        <section className="dbzs-workbench__primary">{primary}</section>
        <aside className="dbzs-workbench__inspector">{inspector}</aside>
      </section>
      <section className="dbzs-workbench__dock">{dock}</section>
      {statusBar}
    </main>
  );
}
