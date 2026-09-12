import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMacAuthResource } from "./macos-auth-configuration.mjs";

const local = {
  API_URL: "http://localhost:3001",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
  SUPABASE_SERVICE_ROLE_KEY: "must-not-be-copied",
  PASSWORD: "must-not-be-copied",
};
const api = { SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL };
const prod = {
  NEXT_PUBLIC_SUPABASE_URL: "https://matching.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_production",
};

test("build resource contains only the exact API and matching public auth values", () => {
  assert.deepEqual(resolveMacAuthResource("local", local, prod, api), {
    WELLSPENT_API_URL: local.API_URL,
    WELLSPENT_SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL,
    WELLSPENT_SUPABASE_PUBLISHABLE_KEY: local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const resource = resolveMacAuthResource("prod-api", local, prod, api);
  assert.equal(resource.WELLSPENT_API_URL, "https://api.wellspent.day");
  assert.equal(resource.WELLSPENT_SUPABASE_URL, prod.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(JSON.stringify(resource).includes("must-not-be-copied"), false);
});

test("missing profiles and a different local API Supabase project fail the build", () => {
  assert.throws(() => resolveMacAuthResource("local", {}, {}, api), /macOS Focus requires/);
  assert.throws(() => resolveMacAuthResource("prod-api", local, {}, api), /Local auth is never used/);
  assert.throws(() => resolveMacAuthResource("local", local, {}, {}), /must match SUPABASE_URL/);
  assert.throws(() => resolveMacAuthResource("local", local, {}, { SUPABASE_URL: "http://127.0.0.1:54321" }), /must match SUPABASE_URL/);
  assert.throws(() => resolveMacAuthResource("prod-api", {}, local, api), /same local\/production/);
});

test("malformed, secret, service-role and bearer keys cannot enter the app bundle", () => {
  const jwt = (role) => `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  for (const key of ["", "sb_publishable_", "sb_publishable_bad key", "sb_secret_private", "Bearer token", jwt("service_role"), jwt("authenticated")]) {
    assert.throws(() => resolveMacAuthResource("local", { ...local, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }, {}, api));
  }
  assert.equal(resolveMacAuthResource("local", { ...local, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }, {}, api).WELLSPENT_SUPABASE_PUBLISHABLE_KEY, jwt("anon"));
});

test("credential-bearing URLs and insecure hosted auth are rejected", () => {
  for (const url of ["https://user:password@matching.supabase.co", "https://matching.supabase.co?token=secret", "https://matching.supabase.co/path", "http://matching.supabase.co"]) {
    assert.throws(() => resolveMacAuthResource("prod-api", local, { ...prod, NEXT_PUBLIC_SUPABASE_URL: url }, api));
  }
});
