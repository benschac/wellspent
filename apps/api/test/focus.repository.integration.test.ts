import { describe, expect, it } from "bun:test";
import type { WorkEventInput } from "@repo/api-contract";
import { createDatabaseConnection, type Database } from "@repo/database";
import {
  focusCaptureTokens,
  focusTransitions,
  focusWorkEvents,
} from "@repo/database/schema";
import { eq, sql } from "drizzle-orm";
import { FocusRepository } from "../src/focus/focus.repository.js";

// Explicit opt-in; never consume DATABASE_URL, which could refer to production.
const testUrl = process.env.FOCUS_TEST_DATABASE_URL;
if (
  testUrl !== undefined &&
  !["127.0.0.1", "localhost"].includes(new URL(testUrl).hostname)
) {
  throw new Error(
    "Focus integration tests require a local disposable database",
  );
}
const suite = testUrl === undefined ? describe.skip : describe;
const rollback = new Error("rollback test fixture");

async function fixture(
  run: (context: {
    repository: FocusRepository;
    db: Database;
    userId: string;
    otherId: string;
  }) => Promise<void>,
) {
  const connection = createDatabaseConnection(testUrl!);
  try {
    await connection.database.transaction(async (tx) => {
      const userId = crypto.randomUUID();
      const otherId = crypto.randomUUID();
      await tx.execute(
        sql`insert into auth.users (id) values (${userId}), (${otherId})`,
      );
      const db = tx as unknown as Database;
      await run({ repository: new FocusRepository(db), db, userId, otherId });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await connection.close();
  }
}

const startInput = () => ({
  id: crypto.randomUUID(),
  commandId: crypto.randomUUID(),
  intention: "Fix the refresh-token retry",
  occurredAt: new Date(Date.now() - 3600000).toISOString(),
});
const eventInput = (occurredAt: string): WorkEventInput => ({
  id: crypto.randomUUID(),
  source: "codex",
  sourceSessionId: "test-thread",
  occurredAt,
  kind: "tool_completed",
  summary: "Tool completed: Bash",
});

suite("FocusRepository with local Supabase", () => {
  it("isolates user-owned sessions and replays create without duplicating transitions", () =>
    fixture(async ({ repository, db, userId, otherId }) => {
      const input = startInput();
      const created = await repository.create(userId, input);
      expect(created.revision).toBe(1);
      expect(await repository.create(userId, input)).toEqual(created);
      expect(await repository.list(otherId)).toEqual([]);
      await expect(repository.get(otherId, input.id)).rejects.toThrow(
        "not found",
      );
      await expect(repository.create(otherId, input)).rejects.toThrow(
        "not found",
      );
      await expect(
        repository.create(userId, { ...input, intention: "different" }),
      ).rejects.toThrow("already used");
      expect(
        await db
          .select()
          .from(focusTransitions)
          .where(eq(focusTransitions.sessionId, input.id)),
      ).toHaveLength(1);
    }));

  it("persists atomic timer history across repository instances and rejects stale conflicting commands", () =>
    fixture(async ({ repository, db, userId }) => {
      const input = startInput();
      await repository.create(userId, input);
      const pause = {
        sessionId: input.id,
        commandId: crypto.randomUUID(),
        action: "pause" as const,
        expectedRevision: 1,
        occurredAt: new Date(
          Date.parse(input.occurredAt) + 900000,
        ).toISOString(),
      };
      const paused = await repository.transition(userId, pause);
      expect(paused.elapsedMs).toBe(900000);
      expect(await new FocusRepository(db).transition(userId, pause)).toEqual(
        paused,
      );
      await expect(
        repository.transition(userId, {
          ...pause,
          commandId: crypto.randomUUID(),
        }),
      ).rejects.toThrow("another device");
      await expect(
        repository.transition(userId, { ...pause, action: "finish" }),
      ).rejects.toThrow("different command");
      const resume = {
        ...pause,
        commandId: crypto.randomUUID(),
        action: "resume" as const,
        expectedRevision: 2,
        occurredAt: new Date(
          Date.parse(input.occurredAt) + 1800000,
        ).toISOString(),
      };
      await repository.transition(userId, resume);
      const completed = await repository.transition(userId, {
        ...resume,
        commandId: crypto.randomUUID(),
        action: "finish",
        expectedRevision: 3,
        occurredAt: new Date(
          Date.parse(input.occurredAt) + 3600000,
        ).toISOString(),
      });
      expect(completed.elapsedMs).toBe(2700000);
      expect((await repository.get(userId, input.id)).segments).toHaveLength(3);
      expect(
        await db
          .select()
          .from(focusTransitions)
          .where(eq(focusTransitions.sessionId, input.id)),
      ).toHaveLength(4);
    }));

  it("keeps recap revisions independent from timer revisions and preserves user edits after new evidence", () =>
    fixture(async ({ repository, userId }) => {
      const input = startInput();
      await repository.create(userId, input);
      await repository.updateRecap(userId, {
        sessionId: input.id,
        text: "Fixed retry; device check pending",
        expectedRevision: 0,
      });
      const replay = await repository.updateRecap(userId, {
        sessionId: input.id,
        text: "Fixed retry; device check pending",
        expectedRevision: 0,
      });
      expect(replay.session.recapRevision).toBe(1);
      expect(replay.session.revision).toBe(1);
      await expect(
        repository.updateRecap(userId, {
          sessionId: input.id,
          text: "stale edit",
          expectedRevision: 0,
        }),
      ).rejects.toThrow("recap changed");
      const detail = await repository.addNote(userId, {
        sessionId: input.id,
        id: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        summary: "Tests passed",
        evidenceUrl: "https://github.com/example/repo/pull/1",
      });
      expect(detail.session.recapText).toBe(
        "Fixed retry; device check pending",
      );
      expect(detail.generatedRecap).toContain("Your note: Tests passed");
      expect(detail.events[0]?.evidenceUrl).toBe(
        "https://github.com/example/repo/pull/1",
      );
    }));

  it("hashes scoped credentials, deduplicates evidence and rejects expired/revoked/wrong-session tokens", () =>
    fixture(async ({ repository, db, userId, otherId }) => {
      const input = startInput();
      const other = startInput();
      await repository.create(userId, input);
      await repository.create(otherId, other);
      const credential = await repository.createCaptureToken(userId, input.id);
      const authorization = `Bearer ${credential.token}`;
      const [stored] = await db
        .select()
        .from(focusCaptureTokens)
        .where(eq(focusCaptureTokens.sessionId, input.id));
      expect(stored?.tokenHash).not.toBe(credential.token);
      expect(stored?.tokenHash).toHaveLength(64);
      const event = eventInput(new Date().toISOString());
      expect(
        await repository.ingest(authorization, input.id, [event, event]),
      ).toEqual({ acceptedEventIds: [event.id], rejectedEvents: [] });
      expect(await repository.ingest(authorization, input.id, [event])).toEqual(
        { acceptedEventIds: [event.id], rejectedEvents: [] },
      );
      expect(
        await db
          .select()
          .from(focusWorkEvents)
          .where(eq(focusWorkEvents.sessionId, input.id)),
      ).toHaveLength(1);
      expect(
        await repository.ingest(authorization, input.id, [
          { ...event, summary: "changed" },
        ]),
      ).toEqual({
        acceptedEventIds: [],
        rejectedEvents: [{ id: event.id, reason: "id_conflict" }],
      });
      await expect(
        repository.ingest(authorization, other.id, [event]),
      ).rejects.toThrow("invalid");
      await expect(
        repository.createCaptureToken(otherId, input.id),
      ).rejects.toThrow("not found");
      await repository.revokeCaptureToken(userId, input.id);
      await expect(
        repository.ingest(authorization, input.id, [event]),
      ).rejects.toThrow("revoked");
      const next = await repository.createCaptureToken(userId, input.id);
      await db
        .update(focusCaptureTokens)
        .set({ expiresAt: new Date(0) })
        .where(eq(focusCaptureTokens.sessionId, input.id));
      await expect(
        repository.ingest(`Bearer ${next.token}`, input.id, [event]),
      ).rejects.toThrow("expired");
    }));

  it("accepts delayed in-session evidence even when its batch also contains events outside the time window", () =>
    fixture(async ({ repository, db, userId }) => {
      const input = startInput();
      await repository.create(userId, input);
      const token = await repository.createCaptureToken(userId, input.id);
      const finishAt = new Date(Date.now() - 600000).toISOString();
      await repository.transition(userId, {
        sessionId: input.id,
        commandId: crypto.randomUUID(),
        action: "finish",
        expectedRevision: 1,
        occurredAt: finishAt,
      });
      const valid = eventInput(
        new Date(Date.parse(input.occurredAt) + 600000).toISOString(),
      );
      const outside = eventInput(new Date().toISOString());
      expect(
        await repository.ingest(`Bearer ${token.token}`, input.id, [
          outside,
          valid,
        ]),
      ).toEqual({
        acceptedEventIds: [valid.id],
        rejectedEvents: [{ id: outside.id, reason: "outside_session" }],
      });
      expect(
        await db
          .select()
          .from(focusWorkEvents)
          .where(eq(focusWorkEvents.sessionId, input.id)),
      ).toHaveLength(1);
      await repository.ingest(`Bearer ${token.token}`, input.id, [valid]);
      expect((await repository.get(userId, input.id)).events).toHaveLength(1);
    }));

  it("uses remaining session capacity without stranding valid evidence behind rejected events", () =>
    fixture(async ({ repository, db, userId }) => {
      const input = startInput();
      await repository.create(userId, input);
      const credential = await repository.createCaptureToken(userId, input.id);
      await db.insert(focusWorkEvents).values(
        Array.from({ length: 1999 }, () => ({
          sessionId: input.id,
          id: crypto.randomUUID(),
          source: "codex" as const,
          sourceSessionId: "capacity-fixture",
          kind: "tool_completed" as const,
          summary: "Tool completed",
          occurredAt: new Date(),
          fingerprint: crypto.randomUUID(),
        })),
      );
      const future = eventInput(new Date(Date.now() + 3600000).toISOString());
      const accepted = eventInput(new Date().toISOString());
      const overflow = eventInput(new Date().toISOString());
      expect(
        await repository.ingest(`Bearer ${credential.token}`, input.id, [
          future,
          accepted,
          overflow,
        ]),
      ).toEqual({
        acceptedEventIds: [accepted.id],
        rejectedEvents: [
          { id: future.id, reason: "future_timestamp" },
          { id: overflow.id, reason: "session_limit" },
        ],
      });
      // A retry of already accepted evidence must remain acknowledged at capacity.
      expect(
        (
          await repository.ingest(`Bearer ${credential.token}`, input.id, [
            accepted,
          ])
        ).acceptedEventIds,
      ).toEqual([accepted.id]);
    }));
});
