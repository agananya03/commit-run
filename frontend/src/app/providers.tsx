"use client";

import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { EvidencePanelProvider } from "@/components/EvidencePanel";
import { WatchdogGlobalListener } from "@/components/WatchdogGlobalListener";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WatchdogGlobalListener />
        <EvidencePanelProvider>
          {children}
        </EvidencePanelProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
