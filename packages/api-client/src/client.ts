import { createORPCClient } from "@orpc/client";
import type { RouterContractClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { RouterUtils } from "@orpc/tanstack-query";
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

export function createApiQueryUtils(client: ApiClient): RouterUtils<ApiClient> {
  return createTanstackQueryUtils(client);
}

export type ApiQueryUtils = ReturnType<typeof createApiQueryUtils>;
