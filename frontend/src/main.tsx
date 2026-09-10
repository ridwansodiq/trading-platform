import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // A 401 means the session is gone; retrying cannot fix it.
      retry: (failureCount, error) =>
        failureCount < 1 && !(error as { status?: number } | null)?.status,
      refetchOnWindowFocus: false
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster position="bottom-right" visibleToasts={3} />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
