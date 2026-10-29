// Sets the interface language before anything renders.
import "./lib/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "./lib/session";
import { App } from "./App";
import "./index.css";

import { initTheme } from "./lib/theme";

initTheme();

// Makes the app installable on phones and computers (production builds only: in development, Vite serves the code).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// Requests are sent even when the browser says it is offline: the service worker then answers
// from its offline copy, and changes are queued (see lib/offline.ts).
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, networkMode: "always" }, mutations: { networkMode: "always" } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
