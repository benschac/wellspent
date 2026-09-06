import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Database } from "@repo/database";
import {
  googleCalendarConnections,
  googleConnections,
  googleOauthStates,
  googleSheetsConnections,
} from "@repo/database/schema";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { DATABASE } from "../database/database.constants.js";
import type { GoogleIntegration } from "./google.config.js";

export type GoogleConnection = typeof googleConnections.$inferSelect;

@Injectable()
export class GoogleRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  async find(userId: string) {
    const [row] = await this.db
      .select()
      .from(googleConnections)
      .where(eq(googleConnections.userId, userId));
    return row;
  }
  async createState(input: typeof googleOauthStates.$inferInsert) {
    await this.db
      .delete(googleOauthStates)
      .where(lt(googleOauthStates.expiresAt, new Date()));
    await this.db.insert(googleOauthStates).values(input);
  }
  async cancelStates(userId: string, integration: GoogleIntegration) {
    await this.db
      .delete(googleOauthStates)
      .where(
        and(
          eq(googleOauthStates.userId, userId),
          eq(googleOauthStates.integration, integration),
        ),
      );
  }
  async consumeState(stateHash: string, integration: GoogleIntegration) {
    const [row] = await this.db
      .delete(googleOauthStates)
      .where(
        and(
          eq(googleOauthStates.stateHash, stateHash),
          eq(googleOauthStates.integration, integration),
          gt(googleOauthStates.expiresAt, new Date()),
        ),
      )
      .returning();
    return row;
  }
  async save(input: {
    userId: string;
    googleSubject: string;
    encryptedRefreshToken: string;
    grantedScopes: string[];
  }) {
    // Serialize OAuth callbacks for the same app user, including first connection.
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(googleConnections)
        .where(eq(googleConnections.userId, input.userId));
      if (
        existing?.googleSubject &&
        existing.googleSubject !== input.googleSubject
      ) {
        throw new ConflictException(
          "Connect the same Google account used by your other integrations",
        );
      }
      if (
        existing?.grantedScopes.some(
          (scope) => !input.grantedScopes.includes(scope),
        )
      ) {
        throw new ConflictException(
          "Google permissions changed during authorization; reconnect to grant all integration permissions",
        );
      }
      await tx
        .insert(googleConnections)
        .values(input)
        .onConflictDoUpdate({
          target: googleConnections.userId,
          set: { ...input, reconnectRequired: false, updatedAt: new Date() },
        });
    });
  }
  async markReconnectRequired(userId: string, encryptedRefreshToken: string) {
    await this.db
      .update(googleConnections)
      .set({ reconnectRequired: true, updatedAt: new Date() })
      .where(
        and(
          eq(googleConnections.userId, userId),
          eq(googleConnections.encryptedRefreshToken, encryptedRefreshToken),
        ),
      );
  }
  async deleteAll(userId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(googleOauthStates)
        .where(eq(googleOauthStates.userId, userId));
      await tx
        .delete(googleCalendarConnections)
        .where(eq(googleCalendarConnections.userId, userId));
      await tx
        .delete(googleConnections)
        .where(eq(googleConnections.userId, userId));
    });
  }
  async sheetsEnabled(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: googleSheetsConnections.userId })
      .from(googleSheetsConnections)
      .where(eq(googleSheetsConnections.userId, userId));
    return row !== undefined;
  }
  async enableSheets(userId: string) {
    await this.db
      .insert(googleSheetsConnections)
      .values({ userId })
      .onConflictDoNothing();
  }
  async disableSheets(userId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(googleOauthStates)
        .where(
          and(
            eq(googleOauthStates.userId, userId),
            eq(googleOauthStates.integration, "sheets"),
          ),
        );
      await tx
        .delete(googleSheetsConnections)
        .where(eq(googleSheetsConnections.userId, userId));
    });
  }
}
