import { describe, expect, it } from "bun:test";
import { createDatabaseConnection, type Database } from "@repo/database";
import {
  focusSessions,
  googleCalendarConnections,
  googleCalendarEventLinks,
  googleCalendarJobs,
} from "@repo/database/schema";
import { eq, sql } from "drizzle-orm";
import { GoogleCalendarRepository } from "../src/google-calendar/google-calendar.repository.js";
import { createCalendarPublication } from "../src/google-calendar/google-calendar-publication.js";

const url = process.env.GOOGLE_TEST_DATABASE_URL;
if (
  url !== undefined &&
  url !== "postgresql://postgres:postgres@127.0.0.1:54422/postgres"
)
  throw new Error("Google database tests require Timer's fixed local database");
const suite = url ? describe : describe.skip;
const rollback = new Error("rollback publication fixtures");

suite("Calendar publication repository (local rollback only)", () => {
  it("isolates owners, deduplicates immutable snapshots, and recovers failed/abandoned jobs", async () => {
    if (!url) throw new Error("GOOGLE_TEST_DATABASE_URL required");
    const connection = createDatabaseConnection(url);
    try {
      await connection.database.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '3s'`);
        const db = tx as unknown as Database;
        const repo = new GoogleCalendarRepository(db);
        const userId = crypto.randomUUID(),
          otherId = crypto.randomUUID();
        await tx.execute(
          sql`insert into auth.users (id) values (${userId}), (${otherId})`,
        );
        const [calendar] = await tx
          .insert(googleCalendarConnections)
          .values({
            userId,
            calendarId: "test-calendar",
            encryptedRefreshToken: "test-only",
            grantedScopes: [],
          })
          .returning();
        if (!calendar) throw new Error("Calendar fixture missing");
        const [session] = await tx
          .insert(focusSessions)
          .values({
            id: crypto.randomUUID(),
            userId,
            intention: "Test",
            status: "completed",
            createdAt: new Date("2026-09-07T10:00:00Z"),
            completedAt: new Date("2026-09-07T11:00:00Z"),
            elapsedMs: 3000000,
          })
          .returning();
        if (!session) throw new Error("Session fixture missing");
        expect(
          await repo.findCompletedPublicationSessions(otherId, [session.id]),
        ).toEqual([]);
        expect(
          await repo.findCompletedPublicationSessions(userId, [session.id]),
        ).toHaveLength(1);
        const payload = createCalendarPublication(calendar.id, session);
        await repo.enqueuePublications(calendar.id, [payload]);
        await repo.enqueuePublications(calendar.id, [
          { ...payload, event: { ...payload.event, summary: "Changed" } },
        ]);
        expect(await repo.listPublications(otherId)).toEqual([]);
        const jobs = await tx
          .select()
          .from(googleCalendarJobs)
          .where(eq(googleCalendarJobs.connectionId, calendar.id));
        expect(jobs).toHaveLength(1);
        const job = jobs[0];
        if (!job) throw new Error("Publication fixture missing");
        expect(job.payload).toEqual(payload);

        // Prioritize only this fixture; never reschedule existing local jobs.
        await tx
          .update(googleCalendarJobs)
          .set({ availableAt: new Date(0) })
          .where(eq(googleCalendarJobs.id, job.id));
        const claimed = await repo.claimNextJob("worker-a");
        expect(claimed?.id).toBe(job.id);
        await repo.completeJob(job.id, "wrong-worker");
        expect((await repo.listPublications(userId))[0]?.status).toBe(
          "processing",
        );
        await tx
          .update(googleCalendarJobs)
          .set({ lockedAt: sql`now() - interval '6 minutes'` })
          .where(eq(googleCalendarJobs.id, job.id));
        await repo.recoverStaleJobs();
        expect((await repo.claimNextJob("worker-b"))?.id).toBe(job.id);
        await repo.completeJob(job.id, "worker-a");
        expect((await repo.listPublications(userId))[0]?.status).toBe(
          "processing",
        );
        await repo.recordPublication(calendar.id, "test-calendar", payload);
        await repo.recordPublication(calendar.id, "test-calendar", payload);
        expect(
          await tx
            .select()
            .from(googleCalendarEventLinks)
            .where(eq(googleCalendarEventLinks.connectionId, calendar.id)),
        ).toHaveLength(1);
        await repo.completeJob(job.id, "worker-b");
        await repo.enqueuePublications(calendar.id, [payload]);
        expect((await repo.listPublications(userId))[0]?.status).toBe(
          "completed",
        );
        await tx
          .update(googleCalendarJobs)
          .set({ status: "dead", attempts: 8 })
          .where(eq(googleCalendarJobs.id, job.id));
        await repo.enqueuePublications(calendar.id, [
          { ...payload, event: { ...payload.event, summary: "Changed again" } },
        ]);
        const [retried] = await tx
          .select()
          .from(googleCalendarJobs)
          .where(eq(googleCalendarJobs.id, job.id));
        expect(retried).toMatchObject({
          status: "pending",
          attempts: 0,
          payload,
        });
        await repo.deleteConnection(calendar.id);
        expect(await repo.listPublications(userId)).toEqual([]);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await connection.close();
    }
  });
});
