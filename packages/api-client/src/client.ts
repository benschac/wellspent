import {
  asyncIteratorToUnproxiedDataStream,
  createORPCClient,
} from "@orpc/client";
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

export async function streamAssistantChat(
  client: ApiClient,
  input: Parameters<ApiClient["assistant"]["chat"]>[0],
  signal?: NonNullable<
    Parameters<ApiClient["assistant"]["chat"]>[1]
  >["signal"],
) {
  const iterator = await client.assistant.chat(input, { signal });

  return asyncIteratorToUnproxiedDataStream(iterator);
}

export type ApiQueryUtils = ReturnType<typeof createApiQueryUtils>;
