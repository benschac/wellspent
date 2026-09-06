import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient } from "@repo/api-client";

test("the API client reads the current bearer for every request and leaves anonymous calls anonymous", async () => {
  const originalFetch = globalThis.fetch;
  const headers: Array<string | null> = [];
  globalThis.fetch = async (request, init) => {
    headers.push(
      new Headers(
        request instanceof Request ? request.headers : init?.headers,
      ).get("Authorization"),
    );
    return new Response("[]", {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    let token = "first-test-token";
    const client = createApiClient("https://api.example.test", {
      getAccessToken: async () => token,
    });
    await client.focus.list();
    token = "refreshed-test-token";
    await client.focus.list();
    await createApiClient("https://api.example.test").focus.list();
    assert.deepEqual(headers, [
      "Bearer first-test-token",
      "Bearer refreshed-test-token",
      null,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
