import { createApiClient, createApiQueryUtils } from "@repo/api-client";
import { env } from "../env";
import { replaceLocalhost } from "./get-localhost";

const createTimerRealtimeUrl = (): string => {
  const realtimeUrl = new URL(
    "/api/ws",
    replaceLocalhost(env.EXPO_PUBLIC_API_URL),
  );
  realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";

  return realtimeUrl.toString();
};

const apiOrigin = replaceLocalhost(env.EXPO_PUBLIC_API_URL);

export const api = createApiClient(apiOrigin);
export const orpc = createApiQueryUtils(api);
export { apiOrigin };
export const getTimerRealtimeUrl = createTimerRealtimeUrl;
