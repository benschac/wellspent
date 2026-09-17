import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { connect, openWorkLog } from "./client.mjs";
import { createMcpHandler, serveMcp } from "./mcp.mjs";

const userId = "10000000-0000-4000-8000-000000000000";
const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "timer-work-log-test-"));
  roots.push(root);
  const configPath = join(root, "config.json");
  const entries = new Map();
  const requests = [];
  let offline = false;
  let account = userId;
  let loseAck = false;
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    if (offline) throw new Error("offline");
    expect(init.redirect).toBe("error");
    const path = new URL(url).pathname;
    if (path === "/api/work-log/identity")
      return Response.json({ userId: account });
    if (path !== "/api/work-log/events")
      return new Response(null, { status: 404 });
    if (init.method === "POST") {
      const input = JSON.parse(init.body);
      const acceptedEventIds = [];
      const rejectedEvents = [];
      for (const event of input.events) {
        const existing = entries.get(event.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
          rejectedEvents.push({ id: event.id, reason: "id_conflict" });
        } else {
          entries.set(event.id, event);
          acceptedEventIds.push(event.id);
        }
      }
      if (loseAck) {
        loseAck = false;
        throw new Error("response lost after commit");
      }
      return Response.json({ acceptedEventIds, rejectedEvents });
    }
    return Response.json({
      entries: [...entries.values()].map((event) => ({
        ...event,
        receivedAt: event.occurredAt,
      })),
      nextCursor: null,
    });
  };
  const token = "twl_test";
  await connect(
    configPath,
    { apiOrigin: "https://timer.example", project: "timer" },
    token,
    fetchImpl,
  );
  return {
    configPath,
    entries,
    requests,
    fetchImpl,
    token,
    offline: (value) => {
      offline = value;
    },
    account: (value) => {
      account = value;
    },
    loseAck: () => {
      loseAck = true;
    },
    open: () => openWorkLog(configPath, { token, fetchImpl }),
  };
}

describe("work-log CLI through the real API client", () => {
  test("logs with no focus session and reads persisted work", async () => {
    const f = await fixture();
    const client = await f.open();
    const result = await client.log({ summary: "Fixed retry ordering" });
    expect(result.status).toBe("acknowledged");
    const history = await client.list();
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({
      id: result.id,
      source: "cli",
      project: "timer",
      summary: "Fixed retry ordering",
    });
    expect(history.entries[0].sessionId).toBeUndefined();
    expect(f.requests.every(({ url }) => !url.includes("/focus/"))).toBe(true);
  });

  test("offline entry survives reopening and lost acknowledgement retry", async () => {
    const f = await fixture();
    f.offline(true);
    const original = await (await f.open()).log({
      summary: "Investigated reconnect",
      occurredAt: "2026-09-08T10:00:00Z",
    });
    expect(original.status).toBe("queued");
    expect(f.entries.size).toBe(0);
    f.offline(false);
    f.loseAck();
    expect((await (await f.open()).flush()).reason).toBe(
      "offline_or_unacknowledged",
    );
    expect(f.entries.size).toBe(1);
    expect((await (await f.open()).flush()).acknowledged).toBe(1);
    expect(f.entries.size).toBe(1);
    expect(f.entries.get(original.id).occurredAt).toBe(
      "2026-09-08T10:00:00.000Z",
    );
    expect((await (await f.open()).status()).queue.currentSession).toBe(0);
  });

  test("another account's credential cannot upload or read the configured log", async () => {
    const f = await fixture();
    f.account("20000000-0000-4000-8000-000000000000");
    const client = await f.open();
    const result = await client.log({ summary: "Keep this account private" });
    expect(result.status).toBe("queued");
    expect(result.delivery.reason).toBe("identity_mismatch");
    expect(f.entries.size).toBe(0);
    await expect(client.list()).rejects.toThrow("another account");
  });

  test("invalid input never enters the queue; credentials are not written to config", async () => {
    const f = await fixture();
    const client = await f.open();
    await expect(client.log({ summary: "", token: "secret" })).rejects.toThrow(
      "Invalid work entry",
    );
    await expect(client.list({ from: "yesterday" })).rejects.toThrow(
      "Invalid history filter",
    );
    expect((await client.status()).queue.currentSession).toBe(0);
    expect(await Bun.file(f.configPath).text()).not.toContain(f.token);
  });
});

describe("stdio MCP protocol", () => {
  async function initialized(open) {
    const handle = createMcpHandler(open);
    const response = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    expect(response.result.capabilities).toEqual({ tools: {} });
    await handle({ jsonrpc: "2.0", method: "notifications/initialized" });
    return handle;
  }
  test("initialization/discovery work without credentials; tools log and read through SDK", async () => {
    const f = await fixture();
    const handle = await initialized(f.open);
    const listed = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      "log_work",
      "list_work",
      "flush_work",
      "work_log_status",
    ]);
    const log = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "log_work", arguments: { summary: "Reviewed schema" } },
    });
    expect(JSON.parse(log.result.content[0].text).status).toBe("acknowledged");
    const history = await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "list_work", arguments: {} },
    });
    expect(JSON.parse(history.result.content[0].text).entries[0].source).toBe(
      "mcp",
    );
  });
  test("rejects invalid protocol calls and sanitizes tool errors", async () => {
    const handle = await initialized(async () => {
      throw new Error("secret token and private path");
    });
    expect(
      (
        await handle({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "unknown" },
        })
      ).error.code,
    ).toBe(-32602);
    const failed = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_work" },
    });
    expect(failed.result.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("secret token");
  });
  test("newline transport recovers from malformed JSON and emits no non-protocol output", async () => {
    const chunks = [];
    await serveMcp(
      Readable.from(["oops\n", '{"jsonrpc":"2.0","id":2,"method":"ping"}\n']),
      { write: (chunk) => chunks.push(chunk) },
      () => {
        throw new Error("unused");
      },
    );
    expect(chunks.map((chunk) => JSON.parse(chunk))).toEqual([
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
  });
});
