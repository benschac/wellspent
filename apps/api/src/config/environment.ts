import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

const server = {
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000,http://localhost:8081"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
};

export type Environment = {
  [Key in keyof typeof server]: z.infer<(typeof server)[Key]>;
};

export function validateEnvironment(
  environment: Record<string, string | number | boolean | undefined>,
): Environment {
  return createEnv({
    server,
    runtimeEnv: environment,
    emptyStringAsUndefined: true,
  });
}
