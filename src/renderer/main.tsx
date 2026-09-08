import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { LogcatWindow } from "./LogcatWindow";
import { ManagerWindow } from "./ManagerWindow";
import { DecompilerWindow } from "./DecompilerWindow";
import "./styles.css";

const view = new URLSearchParams(window.location.search).get("view");

function renderView() {
  if (view === "logcat") return <LogcatWindow />;
  if (view === "decompiler") return <DecompilerWindow />;
  if (view === "apps" || view === "files" || view === "device-info") {
    return <ManagerWindow view={view} />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {renderView()}
  </React.StrictMode>
);
