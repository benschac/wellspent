"use client";

import { createApiClient, createApiQueryUtils } from "@repo/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { env } from "./env";

const api = createApiClient(env.NEXT_PUBLIC_API_URL);

export const orpc = createApiQueryUtils(api);

export function QueryProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
