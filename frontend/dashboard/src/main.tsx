/* =============================================================================
 * main.tsx - entry point Vite
 *
 * Urutan import CSS PENTING:
 *   1. tokens.css   → variabel design tokens (harus pertama supaya bisa
 *                     dikonsumsi semua CSS lain)
 *   2. globals.css  → reset & dasar elemen
 *   3. primitives.css → styling UI primitives (Card, Button, dll)
 *   4. layout.css   → styling AppShell/TopNav/Logo
 *
 * CSS per-page (login.css/dashboard.css/dll) di-import dari masing-masing
 * page component supaya hanya ter-load saat page dipakai (code splitting).
 * ========================================================================== */

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";

import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/primitives.css";
import "./components/layout/layout.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
