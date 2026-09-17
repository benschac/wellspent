import type { GeneratedPageProps } from "fumadocs-openapi";
import { openapi } from "../lib/openapi";
import { APIReference } from "./api-reference";
export async function OpenAPIPage({ document, ...props }: GeneratedPageProps) {
  if (typeof document !== "string")
    throw new Error("Expected a local OpenAPI document ID");
  const payload = await openapi.getSchema(document);
  return <APIReference {...props} payload={payload} />;
}
