import { createORPCClient } from "@orpc/client";
import type { RouterContractClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { workLogContract } from "@repo/api-contract";

export {
  type WorkLogEntry,
  type WorkLogEventInput,
  type WorkLogListInput,
  workLogEventInputSchema,
  workLogListInputSchema,
} from "@repo/api-contract";

export type WorkLogClient = JsonifiedClient<
  RouterContractClient<typeof workLogContract>
>;

/** CLI/MCP entry point without the browser query or assistant adapters. */
export function createWorkLogClient(
  origin: string,
  options: {
    getAccessToken: () => Promise<string | null>;
    fetch?: typeof globalThis.fetch;
  },
): WorkLogClient {
  return createORPCClient(
    new OpenAPILink(workLogContract, {
      origin,
      url: "/api",
      headers: async () => {
        const token = await options.getAccessToken();
        if (!token) throw new Error("A work-log credential is required.");
        return { Authorization: `Bearer ${token}` };
      },
      fetch: (url, init) =>
        (options.fetch ?? globalThis.fetch)(url, {
          ...init,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: init.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000),
        }),
    }),
  );
}
