import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createDatabaseConnection } from "@repo/database";
import { sql } from "drizzle-orm";

// This fixture temporarily installs the new policies inside a rolled-back transaction.
// It never consumes DATABASE_URL or changes the installed migration history.
const localUrl = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const testUrl = process.env.FOCUS_REALTIME_TEST_DATABASE_URL;
if (testUrl !== undefined && testUrl !== localUrl)
  throw new Error("Use Timer's fixed local database for Realtime policy tests");
const suite = testUrl === undefined ? describe.skip : describe;
const rollback = new Error("rollback policy fixture");
const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260907151425_focus_realtime_authorization.sql",
    import.meta.url,
  ),
  "utf8",
);

suite("focus Realtime authorization on local Supabase", () => {
  it("allows own receive, denies another account and anonymous access, and denies client publishing", async () => {
    const connection = createDatabaseConnection(localUrl);
    try {
      await connection.database.transaction(async (tx) => {
        for (const name of [
          "focus_notifications_receive",
          "focus_notifications_read_boundary",
          "focus_notifications_server_publish_only",
        ]) {
          await tx.execute(
            sql.raw(`DROP POLICY IF EXISTS ${name} ON realtime.messages`),
          );
        }
        for (const statement of migration.split("--> statement-breakpoint"))
          await tx.execute(sql.raw(statement));
        const userId = crypto.randomUUID();
        const messageId = crypto.randomUUID();
        const topic = `focus:${userId}`;
        await tx.execute(
          sql`INSERT INTO realtime.messages (id, topic, extension, private) VALUES (${messageId}, ${topic}, 'broadcast', true)`,
        );
        await tx.execute(
          sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true), set_config('realtime.topic', ${topic}, true)`,
        );
        await tx.execute(sql.raw("SET LOCAL ROLE authenticated"));
        const own = await tx.execute(
          sql`SELECT id FROM realtime.messages WHERE id = ${messageId}`,
        );
        expect(own.rows).toHaveLength(1);
        await tx.execute(sql.raw("RESET ROLE"));
        // Simulate an unrelated feature introducing permissive policies.
        await tx.execute(
          sql.raw(
            "CREATE POLICY focus_test_broad_read ON realtime.messages FOR SELECT TO anon, authenticated USING (true)",
          ),
        );
        await tx.execute(
          sql.raw(
            "CREATE POLICY focus_test_broad_write ON realtime.messages FOR INSERT TO authenticated WITH CHECK (true)",
          ),
        );
        await tx.execute(sql.raw("SET LOCAL ROLE authenticated"));
        await tx.execute(
          sql`SELECT set_config('realtime.topic', ${`focus:${crypto.randomUUID()}`}, true)`,
        );
        expect(
          (
            await tx.execute(
              sql`SELECT id FROM realtime.messages WHERE id = ${messageId}`,
            )
          ).rows,
        ).toHaveLength(0);
        await tx.execute(
          sql`SELECT set_config('realtime.topic', ${topic}, true)`,
        );
        await tx.execute(sql.raw("SAVEPOINT denied_publish"));
        await expect(
          Promise.resolve(
            tx.execute(
              sql`INSERT INTO realtime.messages (topic, extension, private) VALUES (${topic}, 'broadcast', true)`,
            ),
          ),
        ).rejects.toMatchObject({ cause: { code: "42501" } });
        await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT denied_publish"));
        await tx.execute(sql.raw("RESET ROLE"));
        await tx.execute(
          sql`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`,
        );
        await tx.execute(sql.raw("SET LOCAL ROLE anon"));
        expect(
          (
            await tx.execute(
              sql`SELECT id FROM realtime.messages WHERE id = ${messageId}`,
            )
          ).rows,
        ).toHaveLength(0);
        throw rollback;
      });
    } catch (cause) {
      if (cause !== rollback) throw cause;
    } finally {
      await connection.close();
    }
  });
});
