import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { WorkLogEventInput } from "@repo/api-contract";
import { createDatabaseConnection, type Database } from "@repo/database";
import { workLogTokens } from "@repo/database/schema";
import { eq, sql } from "drizzle-orm";
import { WorkLogRepository } from "../src/work-log/work-log.repository.js";

const localUrl = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const testUrl = process.env.WORK_LOG_TEST_DATABASE_URL;
if (testUrl !== undefined && testUrl !== localUrl)
  throw new Error("Use Timer's fixed local database for work log tests");
const suite = testUrl === undefined ? describe.skip : describe;
const rollback = new Error("rollback work log fixture");
const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260908122826_work_log.sql",
    import.meta.url,
  ),
  "utf8",
);

suite("session-independent work log on local Supabase", () => {
  it("persists account-isolated entries, deduplicates retries, pages and revokes scoped credentials", async () => {
    const connection = createDatabaseConnection(localUrl);
    try {
      await connection.database.transaction(async (tx) => {
        const installed = await tx.execute(
          sql`select to_regclass('app.work_log_entries') as name`,
        );
        if (installed.rows[0]?.name === null) {
          for (const statement of migration.split("--> statement-breakpoint"))
            await tx.execute(sql.raw(statement));
        }
        const userId = crypto.randomUUID();
        const otherId = crypto.randomUUID();
        await tx.execute(
          sql`insert into auth.users (id) values (${userId}), (${otherId})`,
        );
        const repository = new WorkLogRepository(tx as unknown as Database);
        const principal = { userId };
        const event: WorkLogEventInput = {
          id: crypto.randomUUID(),
          occurredAt: "2026-09-01T12:00:00.000Z",
          source: "cli",
          sourceSessionId: "shell",
          kind: "note",
          summary: "Investigated authentication",
          project: "timer",
        };
        expect(await repository.ingest(principal, [event])).toEqual({
          acceptedEventIds: [event.id],
          rejectedEvents: [],
        });
        expect(
          await repository.ingest(principal, [
            { ...event, occurredAt: "2026-09-01T12:00:00Z" },
          ]),
        ).toEqual({ acceptedEventIds: [event.id], rejectedEvents: [] });
        expect(
          (
            await repository.ingest(principal, [
              { ...event, summary: "changed" },
            ])
          ).rejectedEvents,
        ).toEqual([{ id: event.id, reason: "id_conflict" }]);
        expect(
          (await repository.list({ userId: otherId }, {})).entries,
        ).toEqual([]);
        expect(
          (await repository.ingest({ userId: otherId }, [event]))
            .acceptedEventIds,
        ).toEqual([event.id]);
        const future = {
          ...event,
          id: crypto.randomUUID(),
          occurredAt: "2099-01-01T00:00:00Z",
        };
        expect(
          (await repository.ingest(principal, [future])).rejectedEvents[0]
            ?.reason,
        ).toBe("future_timestamp");
        const orphan = {
          ...event,
          id: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
        };
        expect(
          (await repository.ingest(principal, [orphan])).rejectedEvents[0]
            ?.reason,
        ).toBe("session_not_found");
        const second = { ...event, id: crypto.randomUUID() };
        await repository.ingest(principal, [second]);
        const firstPage = await repository.list(principal, { limit: 1 });
        expect(firstPage.entries).toHaveLength(1);
        if (!firstPage.nextCursor)
          throw new Error("Expected pagination cursor");
        const secondPage = await repository.list(principal, {
          limit: 1,
          before: firstPage.nextCursor,
        });
        expect(secondPage.entries).toHaveLength(1);
        expect(secondPage.entries[0]?.id).not.toBe(firstPage.entries[0]?.id);
        expect(secondPage.nextCursor).toBeNull();
        expect(
          (await repository.list(principal, { from: "2026-09-02T00:00:00Z" }))
            .entries,
        ).toEqual([]);
        const credential = await repository.createToken(userId, "CLI");
        const tokenPrincipal = await repository.authenticateToken(
          `Bearer ${credential.token}`,
        );
        expect(await repository.identity(tokenPrincipal)).toEqual({ userId });
        expect(
          (await repository.list(tokenPrincipal, {})).entries,
        ).toHaveLength(2);
        const [stored] = await tx
          .select()
          .from(workLogTokens)
          .where(eq(workLogTokens.id, credential.id));
        expect(stored?.tokenHash).not.toContain(credential.token);
        expect(
          JSON.stringify(await repository.listTokens(userId)),
        ).not.toContain(credential.token);
        expect(await repository.listTokens(otherId)).toEqual([]);
        await expect(
          repository.revokeToken(otherId, credential.id),
        ).rejects.toThrow("not found");
        await repository.revokeToken(userId, credential.id);
        await expect(repository.list(tokenPrincipal, {})).rejects.toThrow(
          "Invalid or expired",
        );
        await expect(
          repository.authenticateToken(`Bearer ${credential.token}`),
        ).rejects.toThrow("Invalid or expired");
        await expect(
          repository.authenticateToken(
            `Bearer timer_capture_${"a".repeat(43)}`,
          ),
        ).rejects.toThrow("Invalid work log");
        const expired = await repository.createToken(userId, "expired");
        await tx
          .update(workLogTokens)
          .set({ expiresAt: new Date(0) })
          .where(eq(workLogTokens.id, expired.id));
        await expect(
          repository.authenticateToken(`Bearer ${expired.token}`),
        ).rejects.toThrow("Invalid or expired");
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await connection.close();
    }
  });
});
