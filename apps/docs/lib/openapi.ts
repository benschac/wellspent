import { createOpenAPI } from "fumadocs-openapi/server";
export const openapi = createOpenAPI({
  input: { native: "../../packages/api-contract/openapi.native.json" },
});
