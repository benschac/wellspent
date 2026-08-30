import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  server: {
    API_URL: z.url().default("http://localhost:3001"),
  },
  client: {
    NEXT_PUBLIC_API_URL: z.url().default("http://localhost:3001"),
  },
  runtimeEnv: {
    API_URL: process.env.API_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  emptyStringAsUndefined: true,
});
