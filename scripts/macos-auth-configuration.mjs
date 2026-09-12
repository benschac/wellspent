import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { origin, readEnvironment, resolveProfile } from "./backend-profile.mjs";

// Build a whitelist, never serialize the source environment or server credentials.
export function resolveMacAuthResource(profile, local, production, apiEnvironment) {
  const config = resolveProfile("macos", profile, local, production);
  if (profile === "local" &&
      (!apiEnvironment.SUPABASE_URL ||
       origin(apiEnvironment.SUPABASE_URL) !== origin(config.env.WELLSPENT_SUPABASE_URL))) {
    throw new Error("Local Focus auth must match SUPABASE_URL in apps/api/.env");
  }
  return {
    WELLSPENT_API_URL: config.apiUrl,
    WELLSPENT_SUPABASE_URL: config.env.WELLSPENT_SUPABASE_URL,
    WELLSPENT_SUPABASE_PUBLISHABLE_KEY: config.env.WELLSPENT_SUPABASE_PUBLISHABLE_KEY,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const profile = process.env.WELLSPENT_BACKEND_PROFILE || "local";
    const web = resolve(root, "apps/web");
    const resource = resolveMacAuthResource(profile,
      readEnvironment(web, [".env", ".env.development", ".env.local", ".env.development.local"]),
      readEnvironment(web, [".env.prod-api.local"]),
      readEnvironment(resolve(root, "apps/api"), [".env", ".env.local"]));
    const output = process.argv[2];
    if (!output) throw new Error("Supply the built app's FocusAuthConfiguration.json resource path");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(resource, null, 2)}\n`);
    console.log(`[Well Spent] Bundled ${profile} Focus public configuration`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
