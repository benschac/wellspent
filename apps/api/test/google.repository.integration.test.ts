import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { createDatabaseConnection, type Database } from "@repo/database";
import {
  focusSessions,
  googleCalendarConnections,
  googleConnections,
} from "@repo/database/schema";
import { sql } from "drizzle-orm";
import { GOOGLE_SCOPES } from "../src/google/google.config.js";
import { GoogleRepository } from "../src/google/google.repository.js";
import { GoogleSheetsRepository } from "../src/google-sheets/google-sheets.repository.js";

// Explicit opt-in at the fixed Timer local port; never inherit DATABASE_URL.
const testUrl = process.env.GOOGLE_TEST_DATABASE_URL;
if (
  testUrl !== undefined &&
  testUrl !== "postgresql://postgres:postgres@127.0.0.1:54422/postgres"
) {
  throw new Error("Google database tests require Timer's fixed local database");
}
const suite = testUrl === undefined ? describe.skip : describe;
const rollback = new Error(
  "rollback Google integration fixtures and migrations",
);
const migration = async (name: string) =>
  readFile(
    new URL(`../../../supabase/migrations/${name}.sql`, import.meta.url),
    "utf8",
  );

suite("Google repositories with local Supabase (rollback only)", () => {
  it("backfills Calendar credentials, protects server tables, and isolates exports and grants", async () => {
    if (!testUrl) throw new Error("GOOGLE_TEST_DATABASE_URL is required");
    const connection = createDatabaseConnection(testUrl);
    try {
      await connection.database.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '3s'`);
        const installed = await tx.execute(
          sql`select to_regclass('app.google_connections') as name`,
        );
        if (!installed.rows[0]?.name) {
          await tx.execute(
            sql.raw(
              await migration("20260906212601_shared_google_credentials"),
            ),
          );
        }
        const userId = crypto.randomUUID();
        const otherId = crypto.randomUUID();
        await tx.execute(
          sql`insert into auth.users (id) values (${userId}), (${otherId})`,
        );
        await tx.insert(googleCalendarConnections).values({
          userId,
          encryptedRefreshToken: "legacy-ciphertext",
          grantedScopes: [GOOGLE_SCOPES.calendar],
          status: "connected",
        });
        await tx.execute(
          sql.raw(
            await migration(
              "20260906212609_migrate_calendar_google_credentials",
            ),
          ),
        );
        const db = tx as unknown as Database;
        const google = new GoogleRepository(db);
        expect(await google.find(userId)).toMatchObject({
          encryptedRefreshToken: "legacy-ciphertext",
          googleSubject: null,
          reconnectRequired: false,
          grantedScopes: [GOOGLE_SCOPES.calendar],
        });
        expect(await google.find(otherId)).toBeUndefined();
        const roles = await tx.execute(sql`select relname, relrowsecurity,
          has_table_privilege('anon', oid, 'SELECT') as anon_read,
          has_table_privilege('authenticated', oid, 'SELECT') as user_read,
          has_table_privilege('authenticated', oid, 'INSERT') as user_write,
          has_table_privilege('service_role', oid, 'SELECT') as server_read
          from pg_class where oid in ('app.google_connections'::regclass, 'app.google_oauth_states'::regclass, 'app.google_sheets_connections'::regclass)`);
        expect(roles.rows).toHaveLength(3);
        for (const row of roles.rows)
          expect(row).toMatchObject({
            relrowsecurity: true,
            anon_read: false,
            user_read: false,
            user_write: false,
            server_read: true,
          });

        await google.save({
          userId,
          googleSubject: "google-user",
          encryptedRefreshToken: "combined-ciphertext",
          grantedScopes: [GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.sheets],
        });
        await expect(
          google.save({
            userId,
            googleSubject: "other-account",
            encryptedRefreshToken: "bad",
            grantedScopes: [GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.sheets],
          }),
        ).rejects.toThrow("same Google account");
        await expect(
          google.save({
            userId,
            googleSubject: "google-user",
            encryptedRefreshToken: "bad",
            grantedScopes: [GOOGLE_SCOPES.sheets],
          }),
        ).rejects.toThrow("permissions changed");
        await google.markReconnectRequired(userId, "stale-ciphertext");
        expect((await google.find(userId))?.reconnectRequired).toBe(false);
        await google.markReconnectRequired(userId, "combined-ciphertext");
        expect((await google.find(userId))?.reconnectRequired).toBe(true);

        await google.createState({
          stateHash: "test-state",
          userId,
          integration: "sheets",
          encryptedCodeVerifier: "encrypted",
          expiresAt: new Date(Date.now() + 60000),
        });
        expect(
          await google.consumeState("test-state", "calendar"),
        ).toBeUndefined();
        expect(
          (await google.consumeState("test-state", "sheets"))?.userId,
        ).toBe(userId);
        expect(
          await google.consumeState("test-state", "sheets"),
        ).toBeUndefined();
        await google.enableSheets(userId);
        expect(await google.sheetsEnabled(userId)).toBe(true);
        expect(await google.sheetsEnabled(otherId)).toBe(false);
        await google.disableSheets(userId);
        expect(await google.sheetsEnabled(userId)).toBe(false);
        expect(await google.find(userId)).toBeDefined();

        const ownId = crypto.randomUUID();
        const foreignId = crypto.randomUUID();
        await tx.insert(focusSessions).values([
          {
            id: ownId,
            userId,
            intention: "Own session",
            status: "completed",
            elapsedMs: 60000,
            completedAt: new Date(),
          },
          {
            id: foreignId,
            userId: otherId,
            intention: "Private session",
            status: "completed",
            elapsedMs: 90000,
            completedAt: new Date(),
          },
        ]);
        const sessions = await new GoogleSheetsRepository(db).findSessions(
          userId,
          [ownId, foreignId],
        );
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.id).toBe(ownId);
        await google.enableSheets(userId);
        await google.deleteAll(userId);
        expect(await google.find(userId)).toBeUndefined();
        expect(await google.sheetsEnabled(userId)).toBe(false);
        expect(await tx.select().from(googleConnections)).not.toContainEqual(
          expect.objectContaining({ userId }),
        );
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await connection.close();
    }
  });
});
