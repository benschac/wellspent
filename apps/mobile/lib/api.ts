import { createApiClient } from "@repo/api-client";
import { env } from "../env";

const apiOrigin = env.EXPO_PUBLIC_API_URL;

export const api = createApiClient(apiOrigin);
export { apiOrigin };
