import { OpenAPIGenerator } from "@orpc/openapi";
import { focusContract } from "./contract.ts";
import { workLogContract } from "./work-log.ts";

/** HTTP contracts consumed by native clients; realtime has its own wire protocol. */
export function generateNativeOpenAPI() {
  return new OpenAPIGenerator().generate(
    { focus: focusContract, workLog: workLogContract },
    {
      base: {
        openapi: "3.1.1",
        info: { title: "Timer Native API", version: "1.0.0" },
        servers: [{ url: "/api" }],
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
  );
}
