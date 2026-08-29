import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "@repo/database";
import {
  googleCalendarConnections,
  googleCalendarInboundChanges,
  googleCalendarJobs,
  googleCalendarOauthStates,
  googleCalendarSubscriptions,
} from "@repo/database/schema";
import { DATABASE } from "../database/database.constants.js";

export type GoogleCalendarConnection =
  typeof googleCalendarConnections.$inferSelect;
export type GoogleCalendarSubscription =
  typeof googleCalendarSubscriptions.$inferSelect;
export type GoogleCalendarJob = typeof googleCalendarJobs.$inferSelect;

@Injectable()
export class GoogleCalendarRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async createOauthState(input: {
    encryptedCodeVerifier: string;
    expiresAt: Date;
    stateHash: string;
    userId: string;
  }): Promise<void> {
    await this.database.insert(googleCalendarOauthStates).values(input);
  }

  async consumeOauthState(stateHash: string): Promise<
    | {
        encryptedCodeVerifier: string;
        userId: string;
      }
    | undefined
  > {
    const [state] = await this.database
      .delete(googleCalendarOauthStates)
      .where(
        and(
          eq(googleCalendarOauthStates.stateHash, stateHash),
          gt(googleCalendarOauthStates.expiresAt, new Date()),
        ),
      )
      .returning({
        encryptedCodeVerifier:
          googleCalendarOauthStates.encryptedCodeVerifier,
        userId: googleCalendarOauthStates.userId,
      });
    return state;
  }

  async findConnectionByUserId(
    userId: string,
  ): Promise<GoogleCalendarConnection | undefined> {
    const [connection] = await this.database
      .select()
      .from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.userId, userId))
      .limit(1);
    return connection;
  }

  async findConnectionById(
    id: string,
  ): Promise<GoogleCalendarConnection | undefined> {
    const [connection] = await this.database
      .select()
      .from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.id, id))
      .limit(1);
    return connection;
  }

  async upsertConnection(input: {
    calendarId: string;
    encryptedRefreshToken: string;
    grantedScopes: string[];
    userId: string;
  }): Promise<GoogleCalendarConnection> {
    const [connection] = await this.database
      .insert(googleCalendarConnections)
      .values({ ...input, status: "connected" })
      .onConflictDoUpdate({
        target: googleCalendarConnections.userId,
        set: {
          calendarId: input.calendarId,
          encryptedRefreshToken: input.encryptedRefreshToken,
          grantedScopes: input.grantedScopes,
          status: "connected",
          updatedAt: new Date(),
        },
      })
      .returning();
    if (connection === undefined) {
      throw new Error("Google Calendar connection was not persisted");
    }
    return connection;
  }

  async deleteConnection(id: string): Promise<void> {
    await this.database
      .delete(googleCalendarConnections)
      .where(eq(googleCalendarConnections.id, id));
  }

  async markReconnectRequired(id: string): Promise<void> {
    await this.database
      .update(googleCalendarConnections)
      .set({ status: "reconnect_required", updatedAt: new Date() })
      .where(eq(googleCalendarConnections.id, id));
  }

  async findSubscriptionByConnectionId(
    connectionId: string,
  ): Promise<GoogleCalendarSubscription | undefined> {
    const [subscription] = await this.database
      .select()
      .from(googleCalendarSubscriptions)
      .where(eq(googleCalendarSubscriptions.connectionId, connectionId))
      .limit(1);
    return subscription;
  }

  async findSubscriptionByChannelId(
    channelId: string,
  ): Promise<GoogleCalendarSubscription | undefined> {
    const [subscription] = await this.database
      .select()
      .from(googleCalendarSubscriptions)
      .where(eq(googleCalendarSubscriptions.channelId, channelId))
      .limit(1);
    return subscription;
  }

  async saveSubscription(input: {
    calendarId: string;
    channelId: string;
    channelTokenHash: string;
    connectionId: string;
    expiresAt: Date;
    resourceId: string;
    syncToken: string;
  }): Promise<void> {
    await this.database
      .insert(googleCalendarSubscriptions)
      .values(input)
      .onConflictDoUpdate({
        target: [
          googleCalendarSubscriptions.connectionId,
          googleCalendarSubscriptions.calendarId,
        ],
        set: {
          channelId: input.channelId,
          channelTokenHash: input.channelTokenHash,
          expiresAt: input.expiresAt,
          resourceId: input.resourceId,
          syncToken: input.syncToken,
          updatedAt: new Date(),
        },
      });
  }

  async updateSyncToken(subscriptionId: string, syncToken: string): Promise<void> {
    await this.database
      .update(googleCalendarSubscriptions)
      .set({ syncToken, updatedAt: new Date() })
      .where(eq(googleCalendarSubscriptions.id, subscriptionId));
  }

  async recordInboundChanges(input: {
    changes: Array<{
      changeType: "created_or_updated" | "deleted";
      dedupeKey: string;
      googleEtag?: string;
      googleEventId: string;
      payload: Record<string, unknown>;
    }>;
    connectionId: string;
    calendarId: string;
    nextSyncToken?: string;
    subscriptionId: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      if (input.changes.length > 0) {
        await transaction
          .insert(googleCalendarInboundChanges)
          .values(
            input.changes.map((change) => ({
              calendarId: input.calendarId,
              changeType: change.changeType,
              connectionId: input.connectionId,
              dedupeKey: change.dedupeKey,
              googleEventId: change.googleEventId,
              payload: change.payload,
              ...(change.googleEtag === undefined
                ? {}
                : { googleEtag: change.googleEtag }),
            })),
          )
          .onConflictDoNothing({
            target: googleCalendarInboundChanges.dedupeKey,
          });
      }

      if (input.nextSyncToken !== undefined) {
        await transaction
          .update(googleCalendarSubscriptions)
          .set({ syncToken: input.nextSyncToken, updatedAt: new Date() })
          .where(eq(googleCalendarSubscriptions.id, input.subscriptionId));
      }
    });
  }

  async enqueuePullChanges(input: {
    channelId: string;
    connectionId: string;
    messageNumber: string;
    resourceState: string;
  }): Promise<void> {
    await this.database
      .insert(googleCalendarJobs)
      .values({
        connectionId: input.connectionId,
        jobType: "pull_changes",
        dedupeKey: `google-calendar:${input.channelId}:${input.messageNumber}`,
        payload: {
          channelId: input.channelId,
          resourceState: input.resourceState,
        },
      })
      .onConflictDoNothing({ target: googleCalendarJobs.dedupeKey });
  }

  async enqueueDueRenewals(): Promise<void> {
    const due = await this.database
      .select({
        connectionId: googleCalendarSubscriptions.connectionId,
        expiresAt: googleCalendarSubscriptions.expiresAt,
        id: googleCalendarSubscriptions.id,
      })
      .from(googleCalendarSubscriptions)
      .where(
        sql`${googleCalendarSubscriptions.expiresAt} <= now() + interval '24 hours'`,
      );

    if (due.length === 0) {
      return;
    }
    await this.database
      .insert(googleCalendarJobs)
      .values(
        due.map((subscription) => ({
          connectionId: subscription.connectionId,
          jobType: "renew_watch",
          dedupeKey: [
            "google-calendar-renew",
            subscription.id,
            subscription.expiresAt.toISOString(),
          ].join(":"),
          payload: { subscriptionId: subscription.id },
        })),
      )
      .onConflictDoNothing({ target: googleCalendarJobs.dedupeKey });
  }

  async recoverStaleJobs(): Promise<void> {
    await this.database.execute(sql`
      update google_calendar_jobs
      set
        status = 'pending',
        locked_at = null,
        locked_by = null,
        updated_at = now()
      where status = 'processing'
        and locked_at < now() - interval '5 minutes'
    `);
  }

  async claimNextJob(workerId: string): Promise<GoogleCalendarJob | undefined> {
    const result = await this.database.execute(sql<GoogleCalendarJob>`
      update google_calendar_jobs
      set
        status = 'processing',
        locked_at = now(),
        locked_by = ${workerId},
        updated_at = now()
      where id = (
        select id
        from google_calendar_jobs
        where status = 'pending'
          and available_at <= now()
        order by available_at, created_at
        limit 1
        for update skip locked
      )
      returning
        id,
        connection_id as "connectionId",
        job_type as "jobType",
        dedupe_key as "dedupeKey",
        payload,
        status,
        attempts,
        available_at as "availableAt",
        locked_at as "lockedAt",
        locked_by as "lockedBy",
        last_error as "lastError",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `);
    return result.rows[0] as unknown as GoogleCalendarJob | undefined;
  }

  async completeJob(id: string): Promise<void> {
    await this.database
      .update(googleCalendarJobs)
      .set({
        status: "completed",
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(googleCalendarJobs.id, id));
  }

  async failJob(id: string, message: string): Promise<void> {
    await this.database.execute(sql`
      update google_calendar_jobs
      set
        attempts = attempts + 1,
        status = case when attempts + 1 >= 8 then 'dead' else 'pending' end,
        available_at = now()
          + least(power(2, attempts + 1), 300) * interval '1 second',
        locked_at = null,
        locked_by = null,
        last_error = ${message.slice(0, 2000)},
        updated_at = now()
      where id = ${id}
    `);
  }
}
