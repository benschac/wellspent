import { z } from "zod";

const environmentSchema = z.object({
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000,http://localhost:8081"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  environment: Record<string, unknown>,
): Environment {
  return environmentSchema.parse(environment);
}

