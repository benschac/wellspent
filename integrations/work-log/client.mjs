import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createWorkLogClient,
  workLogEventInputSchema,
  workLogListInputSchema,
} from "@repo/api-client/work-log";
import {
  configure,
  enqueue,
  eventStatus,
  flush,
  loadConfig,
  queueStatus,
  validateConfig,
} from "../codex/timer-capture.mjs";

export const defaultConfigPath = join(
  homedir(),
  ".config",
  "timer",
  "work-log",
  "config.json",
);
export const noteInputSchema = workLogEventInputSchema
  .omit({ source: true, kind: true })
  .partial({ id: true, occurredAt: true, sourceSessionId: true });

export { workLogListInputSchema };

export function sdk(origin, token, fetchImpl = fetch) {
  return createWorkLogClient(origin, {
    getAccessToken: async () => token ?? null,
    fetch: fetchImpl,
  });
}

export async function connect(configPath, input, token, fetchImpl = fetch) {
  // Validate the destination before transmitting a credential. The account ID
  // comes from authenticated server identity, never a caller-supplied account.
  const preliminary = validateConfig({
    ...input,
    mode: "work-log",
    userId: "00000000-0000-4000-8000-000000000000",
  });
  const identity = await sdk(
    preliminary.apiOrigin,
    token,
    fetchImpl,
  ).identity();
  return configure(configPath, { ...preliminary, userId: identity.userId });
}

export async function openWorkLog(
  configPath = defaultConfigPath,
  { token = process.env.TIMER_WORK_LOG_TOKEN, fetchImpl = fetch } = {},
) {
  const config = await loadConfig(configPath);
  if (config.mode !== "work-log") {
    throw new Error("Configure a work-log destination first.");
  }
  const api = sdk(config.apiOrigin, token, fetchImpl);
  async function identity() {
    const current = await api.identity();
    if (current.userId !== config.userId) {
      throw new Error(
        "Credential belongs to another account; reconfigure explicitly.",
      );
    }
    return current;
  }
  async function deliver() {
    return flush(configPath, config, {
      token,
      fetchImpl,
      maxBatches: 5,
      deliverEvents: (events) => api.ingest({ events }),
    });
  }
  return {
    async log(input, source = "cli") {
      const parsed = noteInputSchema.safeParse(input);
      if (!parsed.success)
        throw new Error(
          "Invalid work entry. Supply a summary of 1–2000 characters and valid optional fields.",
        );
      const event = workLogEventInputSchema.parse({
        ...parsed.data,
        id: parsed.data.id ?? randomUUID(),
        occurredAt: parsed.data.occurredAt
          ? new Date(parsed.data.occurredAt).toISOString()
          : new Date().toISOString(),
        sourceSessionId: parsed.data.sourceSessionId ?? source,
        ...(config.project && !parsed.data.project
          ? { project: config.project }
          : {}),
        source,
        kind: "note",
      });
      // Local durable publication happens even when authentication or the
      // network is unavailable. Replay stays bound to this configured account.
      await enqueue(configPath, config, event);
      const delivery = await deliver();
      return {
        id: event.id,
        ...(await eventStatus(configPath, config, event.id)),
        delivery,
      };
    },
    async list(input = {}) {
      const parsed = workLogListInputSchema.safeParse(input);
      if (!parsed.success)
        throw new Error(
          "Invalid history filter. Use UTC ISO timestamps and a limit from 1 to 100.",
        );
      await identity();
      return api.list(parsed.data);
    },
    flush: deliver,
    async status() {
      return {
        userId: config.userId,
        apiOrigin: config.apiOrigin,
        tokenAvailable: Boolean(token),
        queue: await queueStatus(configPath, config),
      };
    },
  };
}
