import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionApi = "https://api.wellspent.day";
const controlledKeys = [
  "API_URL",
  "NEXT_PUBLIC_API_URL",
  "EXPO_PUBLIC_API_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "APP_ENV",
  "NEXT_PUBLIC_APP_ENV",
  "EXPO_PUBLIC_APP_ENV",
  "WELLSPENT_API_URL",
  "WELLSPENT_SUPABASE_URL",
  "WELLSPENT_SUPABASE_PUBLISHABLE_KEY",
  "WELLSPENT_NEXT_DIST_DIR",
];

export function origin(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "API configuration must be an HTTP(S) origin without credentials or a path",
    );
  }
  return url.origin;
}

export function isPublicSupabaseKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "anon";
  } catch {
    return false;
  }
}

function isLocal(value) {
  const host = new URL(value).hostname;
  return (
    host === "localhost" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

// Pure profile resolution: production must never inherit local auth credentials.
export function resolveProfile(
  app,
  profile,
  local = {},
  production = {},
  inherited = {},
) {
  if (
    !["mobile", "web", "macos"].includes(app) ||
    !["local", "prod-api"].includes(profile)
  ) {
    throw new Error(
      "Usage: backend-profile.mjs <mobile|web|macos> <local|prod-api> [--dry-run] [-- <Expo arguments>]",
    );
  }
  const selected = profile === "local" ? local : production;
  const env = { ...inherited, ...selected };
  for (const key of controlledKeys) delete env[key];
  const localUrl =
    selected.LOCAL_API_URL ||
    (app === "mobile"
      ? selected.EXPO_PUBLIC_API_URL
      : selected.API_URL || selected.NEXT_PUBLIC_API_URL) ||
    "http://localhost:3001";
  const apiUrl = profile === "prod-api" ? productionApi : origin(localUrl);
  if (profile === "local" && !isLocal(apiUrl)) {
    throw new Error(
      "The local profile requires a loopback/LAN API. Set LOCAL_API_URL in this app's .env.local; use dev:prod-api for production.",
    );
  }
  Object.assign(env, {
    APP_ENV: profile,
    API_URL: apiUrl,
    NEXT_PUBLIC_API_URL: apiUrl,
    EXPO_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_APP_ENV: profile,
    EXPO_PUBLIC_APP_ENV: profile,
    WELLSPENT_API_URL: apiUrl,
    WELLSPENT_NEXT_DIST_DIR:
      profile === "local" ? ".next-local" : ".next-prod-api",
    EXPO_NO_DOTENV: "1",
    // Backend choice must not turn a development bundle into a release bundle.
    NODE_ENV: "development",
  });
  if (app === "web" || app === "macos") {
    const authUrl = selected.NEXT_PUBLIC_SUPABASE_URL || "";
    const authKey = selected.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
    if (profile === "prod-api" && (!authUrl || !authKey)) {
      throw new Error(
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.prod-api.local (see .env.prod-api.example). Local auth is never used for production.",
      );
    }
    if (authUrl && isLocal(origin(authUrl)) !== (profile === "local")) {
      throw new Error(
        "Supabase and API must target the same local/production profile",
      );
    }
    if (profile === "prod-api" && new URL(authUrl).protocol !== "https:") {
      throw new Error("Production Supabase auth must use HTTPS");
    }
    if (authKey.startsWith("sb_secret_"))
      throw new Error("Use a Supabase publishable key, never a secret key");
    if (app === "macos" && (!authUrl || !isPublicSupabaseKey(authKey)))
      throw new Error("macOS Focus requires NEXT_PUBLIC_SUPABASE_URL and a valid NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in the matching web profile; only publishable/anon keys are allowed");
    env.NEXT_PUBLIC_SUPABASE_URL = authUrl;
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = authKey;
    if (app === "macos") {
      env.WELLSPENT_SUPABASE_URL = authUrl;
      env.WELLSPENT_SUPABASE_PUBLISHABLE_KEY = authKey;
    }
  }
  return {
    env,
    apiUrl,
    port: profile === "local" ? 3000 : 3002,
    metroPort: profile === "local" ? 8081 : 8083,
  };
}

export function readEnvironment(appDir, names) {
  return Object.assign(
    {},
    ...names.map((name) => {
      const path = resolve(appDir, name);
      return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
    }),
  );
}

async function run(command, args, options) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      done(code ?? (signal === "SIGINT" ? 130 : 1));
    });
  });
}

async function main() {
  const [app, profile, ...args] = process.argv.slice(2);
  // Validate before resolving an app path.
  if (!["mobile", "web", "macos"].includes(app))
    throw new Error("Choose mobile, web, or macos");
  const appDir = resolve(root, "apps", app);
  const authDir = app === "macos" ? resolve(root, "apps/web") : appDir;
  const local = readEnvironment(authDir, [
    ".env",
    ".env.development",
    ".env.local",
    ".env.development.local",
  ]);
  const production = readEnvironment(authDir, [".env.prod-api.local"]);
  const config = resolveProfile(app, profile, local, production, process.env);
  const dryRun = args.includes("--dry-run");
  const extra = args.filter((arg) => arg !== "--dry-run" && arg !== "--");
  if (app !== "mobile" && extra.length)
    throw new Error(
      "Extra launch arguments are supported only for Expo; web ports are fixed to isolate browser storage",
    );
  if (extra.some((arg) => arg === "--port" || arg.startsWith("--port=")))
    throw new Error(
      "Profile ports are fixed to prevent accidental environment reuse",
    );
  console.log(
    `[Well Spent] ${profile === "prod-api" ? "PRODUCTION API — actions affect real data" : "LOCAL"}: ${config.apiUrl}`,
  );
  if (app === "web")
    console.log(`[Well Spent] Browser: http://localhost:${config.port}`);
  if (app === "mobile")
    console.log(
      `[Well Spent] Metro port: ${config.metroPort}. Open this server in your dev client, then fully reload.`,
    );
  if (dryRun) return;
  const options = { cwd: appDir, env: config.env };
  if (app === "macos") {
    options.env.WELLSPENT_BACKEND_PROFILE = profile;
    if (process.platform !== "darwin")
      throw new Error("macOS launch requires macOS and Xcode");
    // Never silently reuse an already-running app with the previous profile.
    const running = await run("pgrep", ["-x", "TimerMac"], options);
    if (running === 0)
      throw new Error(
        "Quit the running TimerMac app before changing launch profiles",
      );
    if (running !== 1)
      throw new Error("Could not check for an existing TimerMac process");
    const build = await run("bun", ["run", "build"], options);
    if (build !== 0) {
      process.exitCode = build;
      return;
    }
    process.exitCode = await run(
      resolve(
        appDir,
        ".derivedData/Build/Products/Debug/TimerMac.app/Contents/MacOS/TimerMac",
      ),
      [],
      options,
    );
  } else {
    const command = resolve(
      appDir,
      "node_modules/.bin",
      app === "web" ? "next" : "expo",
    );
    const expoArgs =
      extra[0] && !extra[0].startsWith("-") ? extra : ["start", ...extra];
    const commandArgs =
      app === "web"
        ? ["dev", "--webpack", "--port", String(config.port)]
        : [...expoArgs, "--port", String(config.metroPort)];
    process.exitCode = await run(command, commandArgs, options);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
