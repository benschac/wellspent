import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProfile } from "./backend-profile.mjs";

test("all three apps default to local URLs, independent of inherited production env", () => {
  for (const app of ["mobile", "web", "macos"]) {
    const config = resolveProfile(
      app,
      "local",
      app === "macos" ? { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local" } : {},
      {},
      { API_URL: "https://api.wellspent.day", NODE_ENV: "production" },
    );
    assert.equal(config.apiUrl, "http://localhost:3001");
    assert.equal(config.env.NODE_ENV, "development");
    assert.equal(config.env.NEXT_PUBLIC_API_URL, config.env.API_URL);
  }
});
test("local profile preserves explicit LAN configuration and rejects remote targets", () => {
  assert.equal(
    resolveProfile("mobile", "local", {
      LOCAL_API_URL: "http://192.168.1.2:3001",
    }).apiUrl,
    "http://192.168.1.2:3001",
  );
  assert.throws(
    () =>
      resolveProfile("web", "local", { API_URL: "https://api.wellspent.day" }),
    /local profile requires/,
  );
  assert.throws(
    () =>
      resolveProfile("mobile", "local", {
        LOCAL_API_URL: "http://secret:token@localhost:3001",
      }),
    /without credentials/,
  );
});
test("production web requires its own auth configuration; never falls back to local or inherited auth", () => {
  const local = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-key",
  };
  assert.throws(
    () => resolveProfile("web", "prod-api", local, {}, local),
    /Local auth is never used/,
  );
  assert.throws(
    () => resolveProfile("web", "prod-api", {}, local),
    /same local\/production/,
  );
  const production = {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  };
  const config = resolveProfile("web", "prod-api", local, production, local);
  assert.equal(
    config.env.NEXT_PUBLIC_SUPABASE_URL,
    production.NEXT_PUBLIC_SUPABASE_URL,
  );
  assert.equal(config.port, 3002);
  assert.equal(config.env.WELLSPENT_NEXT_DIST_DIR, ".next-prod-api");
  assert.equal(config.apiUrl, "https://api.wellspent.day");
});
test("local web cannot pair a local API with hosted auth", () => {
  assert.throws(
    () =>
      resolveProfile("web", "local", {
        NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      }),
    /same local\/production/,
  );
});
test("Expo production profile does not require Focus auth", () => {
  for (const app of ["mobile"]) {
    const config = resolveProfile(app, "prod-api");
    assert.equal(config.env.WELLSPENT_API_URL, "https://api.wellspent.day");
    assert.equal(config.env.EXPO_PUBLIC_API_URL, config.env.WELLSPENT_API_URL);
    assert.equal(config.env.APP_ENV, "prod-api");
  }
});
test("unknown app/profile and secret keys fail closed", () => {
  assert.throws(() => resolveProfile("api", "local"), /Usage/);
  assert.throws(() => resolveProfile("web", "production"), /Usage/);
  assert.throws(
    () =>
      resolveProfile(
        "web",
        "prod-api",
        {},
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_private",
        },
      ),
    /never a secret/,
  );
});

test("profiles retain unrelated selected settings and separate Metro ports", () => {
  const local = resolveProfile("mobile", "local", {
    EXPO_PUBLIC_FEATURE: "local",
  });
  const production = resolveProfile(
    "mobile",
    "prod-api",
    {},
    { EXPO_PUBLIC_FEATURE: "production" },
  );
  assert.equal(local.env.EXPO_PUBLIC_FEATURE, "local");
  assert.equal(production.env.EXPO_PUBLIC_FEATURE, "production");
  assert.equal(local.metroPort, 8081);
  assert.equal(production.metroPort, 8083);
});

test("production auth rejects plain HTTP", () => {
  assert.throws(
    () =>
      resolveProfile(
        "web",
        "prod-api",
        {},
        {
          NEXT_PUBLIC_SUPABASE_URL: "http://test.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
        },
      ),
    /must use HTTPS/,
  );
});


test("macOS uses the matching Supabase profile and strips inherited credentials", () => {
  const inherited = { WELLSPENT_SUPABASE_URL: "https://wrong.supabase.co", WELLSPENT_SUPABASE_PUBLISHABLE_KEY: "sb_secret_wrong" };
  const local = resolveProfile("macos", "local", {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
  }, {}, inherited);
  assert.equal(local.env.WELLSPENT_SUPABASE_URL, "http://127.0.0.1:54421");
  assert.equal(local.env.WELLSPENT_SUPABASE_PUBLISHABLE_KEY, "sb_publishable_local");
  assert.throws(() => resolveProfile("macos", "prod-api", {}, {}, inherited), /Local auth is never used/);
  const prod = resolveProfile("macos", "prod-api", {}, {
    NEXT_PUBLIC_SUPABASE_URL: "https://matching.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
  }, inherited);
  assert.equal(prod.env.WELLSPENT_SUPABASE_URL, "https://matching.supabase.co");
  assert.equal(prod.env.WELLSPENT_SUPABASE_PUBLISHABLE_KEY, "sb_publishable_public");
});
