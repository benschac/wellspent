import { createORPCClient } from "@orpc/client";
import type { RouterContractClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { apiContract } from "@repo/api-contract";

export type ApiClient = JsonifiedClient<
  RouterContractClient<typeof apiContract>
>;

export function createApiClient(origin: string): ApiClient {
  const link = new OpenAPILink(apiContract, {
    origin,
    url: "/api",
  });

  return createORPCClient(link);
}
