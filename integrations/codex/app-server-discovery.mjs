// Discovery only. No thread/start, thread/resume, history listing or subscriptions.
// The existing selected-source reader still owns normalization and delivery.

import { isAbsolute } from "node:path";
import { openCodexProxy } from "./app-server-proxy.mjs";
import { opaque } from "./local-contract.mjs";

export const API_DISCOVERY_LIMITS = Object.freeze({
  sessions: 16,
  durationMS: 8000,
  responseBytes: 2 * 1024 * 1024,
  lineBytes: 256 * 1024,
});

export async function discoverLoadedSessions({
  codex,
  permitted,
  maxBytes = API_DISCOVERY_LIMITS.responseBytes,
}) {
  if (!(await permitted())) throw new Error("authorization_required");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("api_response_limit");
  let pending = null;
  let failure = null;
  let nextID = 0;
  function fail(code) {
    failure ??= new Error(code);
    pending?.reject(failure);
    pending = null;
  }
  const proxy = openCodexProxy(
    codex,
    {
      ...API_DISCOVERY_LIMITS,
      responseBytes: Math.min(maxBytes, API_DISCOVERY_LIMITS.responseBytes),
    },
    (message) => {
      if (pending && message?.id === pending.id) {
        const request = pending;
        pending = null;
        if (message.error)
          request.reject(
            new Error(
              request.method === "thread/read"
                ? "api_source_missing"
                : "api_protocol",
            ),
          );
        else request.resolve(message.result);
      }
    },
    fail,
  );
  const timeout = setTimeout(() => {
    fail("api_timeout");
    proxy.close();
  }, API_DISCOVERY_LIMITS.durationMS);
  let checking = false;
  const consent = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      if (!(await permitted())) {
        fail("authorization_required");
        proxy.close();
      }
    } catch {
      fail("authorization_required");
      proxy.close();
    } finally {
      checking = false;
    }
  }, 200);
  async function request(method, params) {
    if (!(await permitted())) throw new Error("authorization_required");
    if (failure) throw failure;
    const id = ++nextID;
    return new Promise((resolve, reject) => {
      pending = { id, method, resolve, reject };
      proxy.send({ id, method, params });
    });
  }
  try {
    await proxy.ready;
    await request("initialize", {
      clientInfo: {
        name: "wellspent_session_discovery",
        title: "WellSpent",
        version: "0.1.0",
      },
    });
    proxy.send({ method: "initialized", params: {} });
    const result = await request("thread/loaded/list", {
      limit: API_DISCOVERY_LIMITS.sessions + 1,
    });
    if (
      !result ||
      !Array.isArray(result.data) ||
      result.data.some((id) => typeof id !== "string" || !opaque.test(id))
    )
      throw new Error("api_protocol");
    if (result.nextCursor || result.data.length > API_DISCOVERY_LIMITS.sessions)
      throw new Error("api_session_limit");
    const sources = [];
    for (const threadID of new Set(result.data)) {
      let result;
      try {
        result = await request("thread/read", {
          threadId: threadID,
          includeTurns: false,
        });
      } catch (error) {
        if (error.message !== "api_source_missing") throw error;
        sources.push({ threadID, path: null, status: "unavailable" });
        continue;
      }
      const thread = result?.thread;
      if (!thread || thread.id !== threadID) throw new Error("api_protocol");
      if (!["idle", "active"].includes(thread.status?.type)) continue;
      sources.push({
        threadID,
        path:
          typeof thread.path === "string" && isAbsolute(thread.path)
            ? thread.path
            : null,
        status: thread.status.type,
      });
    }
    if (!(await permitted())) throw new Error("authorization_required");
    return {
      loadedSessionCount: result.data.length,
      sources,
      bytesRead: proxy.bytesRead(),
    };
  } catch (error) {
    throw failure ?? error;
  } finally {
    clearTimeout(timeout);
    clearInterval(consent);
    proxy.close();
  }
}
