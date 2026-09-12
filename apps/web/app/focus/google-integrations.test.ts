import assert from "node:assert/strict";
import { test } from "node:test";
import { createGoogleIntegrationsClient } from "@repo/api-client";
import { finish, pause, resume, start } from "@repo/session-domain/testing";
import { projectCommand } from "./focus-state";
import {
  googleCallbackMessage,
  googleEligibleSessionIds,
} from "./google-integration-state";

test("sharing excludes running sessions and completed projections with unsaved commands", () => {
  const completed = [start, pause, resume, finish].reduce(projectCommand, []);
  const [session] = completed;
  assert.ok(session);
  assert.deepEqual([...googleEligibleSessionIds(completed, [])], [session.id]);
  assert.equal(googleEligibleSessionIds(completed, [finish]).size, 0);
  assert.equal(googleEligibleSessionIds(completed, [start]).size, 0);
  assert.equal(
    googleEligibleSessionIds([start].reduce(projectCommand, []), []).size,
    0,
  );
});

test("OAuth return text never trusts URL errors or treats a query as connection proof", () => {
  assert.equal(googleCallbackMessage("?google=unknown&result=connected"), null);
  assert.equal(googleCallbackMessage("?google=sheets&result=secret"), null);
  assert.equal(
    googleCallbackMessage("?google=sheets&result=connected"),
    "Returned from Google Sheets. Checking your connection…",
  );
  const error = googleCallbackMessage(
    "?google=calendar&result=error&error=secret-token",
  );
  assert.ok(error);
  assert.ok(error.includes("did not finish"));
  assert.ok(!error.includes("secret-token"));
});

test("Google REST uses current account tokens, explicit write bodies, and abortable requests", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const responses = [
    { enabled: true, connected: true, reconnectRequired: false },
    {
      authorizationUrl:
        "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    },
    {
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/test/edit",
      exportedSessionCount: 1,
    },
    { queuedSessionCount: 1 },
    {
      publications: [
        { sessionId: "saved-session", status: "completed", lastError: null },
      ],
    },
  ];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    const value = responses.shift();
    return value === undefined
      ? new Response(null, { status: 204 })
      : Response.json(value);
  };
  try {
    let token = "initial";
    const client = createGoogleIntegrationsClient("https://api.example.test", {
      getAccessToken: async () => token,
    });
    const controller = new AbortController();
    await client.status("sheets", controller.signal);
    token = "refreshed";
    await client.connect("calendar");
    await client.exportSessions(["saved-session"]);
    await client.publishSessions(["saved-session"]);
    assert.deepEqual(await client.publications(), [
      { sessionId: "saved-session", status: "completed", lastError: null },
    ]);
    await client.disconnect("sheets");
    assert.equal(requests[0]?.init?.signal, controller.signal);
    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        "https://api.example.test/api/integrations/google-sheets/status",
        "https://api.example.test/api/integrations/google-calendar/connect",
        "https://api.example.test/api/integrations/google-sheets/export",
        "https://api.example.test/api/integrations/google-calendar/publish",
        "https://api.example.test/api/integrations/google-calendar/publications",
        "https://api.example.test/api/integrations/google-sheets",
      ],
    );
    assert.deepEqual(
      requests.map(({ init }) =>
        new Headers(init?.headers).get("Authorization"),
      ),
      [
        "Bearer initial",
        "Bearer refreshed",
        "Bearer refreshed",
        "Bearer refreshed",
        "Bearer refreshed",
        "Bearer refreshed",
      ],
    );
    assert.equal(requests[2]?.init?.method, "POST");
    assert.equal(
      requests[2]?.init?.body,
      JSON.stringify({ sessionIds: ["saved-session"] }),
    );
    assert.equal(requests[3]?.init?.body, requests[2]?.init?.body);
    assert.equal(requests[5]?.init?.method, "DELETE");
    assert.ok(
      requests.every(
        ({ init }) => init?.redirect === "error" && init.credentials === "omit",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google REST refuses anonymous or stale account authorization before sending", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };
  try {
    const anonymous = createGoogleIntegrationsClient(
      "https://api.example.test",
      {
        getAccessToken: async () => null,
      },
    );
    await assert.rejects(anonymous.status("calendar"), /Sign in again/);
    const changedAccount = createGoogleIntegrationsClient(
      "https://api.example.test",
      {
        getAccessToken: async () => {
          throw new Error("Account changed");
        },
      },
    );
    await assert.rejects(
      changedAccount.exportSessions(["session"]),
      /Account changed/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google REST rejects untrusted links and malformed publication state", async () => {
  const originalFetch = globalThis.fetch;
  let response: unknown;
  globalThis.fetch = async () => Response.json(response);
  try {
    const client = createGoogleIntegrationsClient("https://api.example.test", {
      getAccessToken: async () => "token",
    });
    for (const url of [
      "javascript:alert(1)",
      "https://docs.google.com.evil.test/spreadsheets/d/test",
      "https://user:password@docs.google.com/spreadsheets/d/test",
      "https://docs.google.com/document/d/test",
      "https://docs.google.com:444/spreadsheets/d/test",
    ]) {
      response = { spreadsheetUrl: url, exportedSessionCount: 1 };
      await assert.rejects(client.exportSessions(["session"]), /invalid link/);
    }
    response = { authorizationUrl: "https://evil.test/oauth" };
    await assert.rejects(client.connect("sheets"), /invalid link/);
    response = {
      publications: [
        { sessionId: "session", status: "success", lastError: null },
      ],
    };
    await assert.rejects(client.publications(), /unexpected response/);
    response = { connected: true };
    await assert.rejects(client.status("calendar"), /unexpected response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed Sheets export does not retry or expose the provider response", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      "provider error contains secret-token and session prose",
      { status: 503 },
    );
  };
  try {
    const client = createGoogleIntegrationsClient("https://api.example.test", {
      getAccessToken: async () => "token",
    });
    await assert.rejects(
      client.exportSessions(["session"]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes("secret-token"));
        assert.ok(!error.message.includes("session prose"));
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
