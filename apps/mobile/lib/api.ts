import { createApiClient } from "@repo/api-client";

const apiOrigin = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

export const api = createApiClient(apiOrigin);
export { apiOrigin };

