/// <reference types="vite/client" />

import type { AndroidToolApi } from "../shared/types";

declare global {
  interface Window {
    androidTool: AndroidToolApi;
  }
}

export {};
