import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@repo/database";
import {
  focusSessions,
  googleCalendarConnections,
  googleCalendarEventLinks,
  googleCalendarInboundChanges,
  googleCalendarJobs,
  googleCalendarOauthStates,
  googleCalendarSubscriptions,
} from "@repo/database/schema";
import { and, desc, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import { DATABASE } from "../database/database.constants.js";
import type { CalendarPublication } from "./google-calendar-publication.js";

export type GoogleCalendarConnection =
  typeof googleCalendarConnections.$inferSelect;
export type GoogleCalendarSubscription =
  typeof googleCalendarSubscriptions.$inferSelect;
export type GoogleCalendarJob = typeof googleCalendarJobs.$inferSelect;

@Injectable()
export class GoogleCalendarRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  findCompletedPublicationSessions(userId: string, sessionIds: string[]) {
    return this.database
      .select()
      .from(focusSessions)
      .where(
        and(
          eq(focusSessions.userId, userId),
          inArray(focusSessions.id, sessionIds),
        ),
      );
  }

  async enqueuePublications(
    connectionId: string,
    publications: CalendarPublication[],
  ) {
    if (!publications.length) return;
    await this.database
      .insert(googleCalendarJobs)
      .values(
        publications.map((publication) => ({
          connectionId,
          jobType: "publish_session",
          dedupeKey: `google-calendar-publish:${connectionId}:${publication.sessionId}`,
          payload: publication,
        })),
      )
      .onConflictDoUpdate({
        target: googleCalendarJobs.dedupeKey,
        // Retry a failed publication using the original immutable snapshot.
        // Repeating a pending or completed request must not schedule another event.
        set: {
          status: "pending",
          attempts: 0,
          availableAt: sql`now()`,
          lastError: null,
          updatedAt: sql`now()`,
        },
        setWhere: eq(googleCalendarJobs.status, "dead"),
      });
  }

  listPublications(userId: string) {
    return this.database
      .select({
        payload: googleCalendarJobs.payload,
        status: googleCalendarJobs.status,
        lastError: googleCalendarJobs.lastError,
      })
      .from(googleCalendarJobs)
      .innerJoin(
        googleCalendarConnections,
        eq(googleCalendarJobs.connectionId, googleCalendarConnections.id),
      )
      .where(
        and(
          eq(googleCalendarConnections.userId, userId),
          eq(googleCalendarJobs.jobType, "publish_session"),
        ),
      )
      .orderBy(desc(googleCalendarJobs.createdAt))
      .limit(500);
  }

  async recordPublication(
    connectionId: string,
    calendarId: string,
    publication: CalendarPublication,
  ) {
    await this.database
      .insert(googleCalendarEventLinks)
      .values({
        connectionId,
        calendarId,
        sessionId: publication.sessionId,
        googleEventId: publication.event.id,
        lastSyncedRevision: publication.revision,
        syncStatus: "synced",
      })
      .onConflictDoNothing({
        target: [
          googleCalendarEventLinks.connectionId,
          googleCalendarEventLinks.sessionId,
        ],
      });
  }

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
        encryptedCodeVerifier: googleCalendarOauthStates.encryptedCodeVerifier,
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

  async updateSyncToken(
    subscriptionId: string,
    syncToken: string,
  ): Promise<void> {
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
    await this.database
      .update(googleCalendarJobs)
      .set({
        status: "pending",
        lockedAt: null,
        lockedBy: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(googleCalendarJobs.status, "processing"),
          lt(googleCalendarJobs.lockedAt, sql`now() - interval '5 minutes'`),
        ),
      );
  }

  async claimNextJob(workerId: string): Promise<GoogleCalendarJob | undefined> {
    const nextJob = this.database.$with("next_job").as(
      this.database
        .select({ id: googleCalendarJobs.id })
        .from(googleCalendarJobs)
        .where(
          and(
            eq(googleCalendarJobs.status, "pending"),
            lte(googleCalendarJobs.availableAt, sql`now()`),
          ),
        )
        .orderBy(googleCalendarJobs.availableAt, googleCalendarJobs.createdAt)
        .limit(1)
        .for("update", { skipLocked: true }),
    );

    const [job] = await this.database
      .with(nextJob)
      .update(googleCalendarJobs)
      .set({
        status: "processing",
        lockedAt: sql`now()`,
        lockedBy: workerId,
        updatedAt: sql`now()`,
      })
      .from(nextJob)
      .where(eq(googleCalendarJobs.id, nextJob.id))
      .returning();
    return job;
  }

  async completeJob(id: string, workerId: string): Promise<void> {
    await this.database
      .update(googleCalendarJobs)
      .set({
        status: "completed",
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(googleCalendarJobs.id, id),
          eq(googleCalendarJobs.status, "processing"),
          eq(googleCalendarJobs.lockedBy, workerId),
        ),
      );
  }

  async failJob(id: string, workerId: string, message: string): Promise<void> {
    await this.database
      .update(googleCalendarJobs)
      .set({
        attempts: sql`${googleCalendarJobs.attempts} + 1`,
        status: sql`case when ${googleCalendarJobs.attempts} + 1 >= 8 then 'dead' else 'pending' end`,
        availableAt: sql`now() + least(power(2, ${googleCalendarJobs.attempts} + 1), 300) * interval '1 second'`,
        lockedAt: null,
        lockedBy: null,
        lastError: message.slice(0, 2000),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(googleCalendarJobs.id, id),
          eq(googleCalendarJobs.status, "processing"),
          eq(googleCalendarJobs.lockedBy, workerId),
        ),
      );
  }
}
