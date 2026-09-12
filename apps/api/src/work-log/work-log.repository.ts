import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/server";
import {
  type WorkLogEntry,
  type WorkLogEventInput,
  type WorkLogListInput,
  workLogEventInputSchema,
  workLogListInputSchema,
} from "@repo/api-contract";
import type { Database } from "@repo/database";
import {
  focusSessions,
  workLogEntries,
  workLogTokens,
} from "@repo/database/schema";
import { addHours, addMinutes, isAfter, parseISO } from "date-fns";
import { and, desc, eq, gte, lt, or } from "drizzle-orm";
import { DATABASE } from "../database/database.constants.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type WorkLogPrincipal = { userId: string; tokenHash?: string };
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Stable field order and timestamp precision make retries independent of JSON key order. */
export function workLogFingerprint(event: WorkLogEventInput) {
  return hash(
    JSON.stringify([
      event.id,
      parseISO(event.occurredAt).toISOString(),
      event.source,
      event.sourceSessionId,
      event.kind,
      event.summary,
      event.project ?? null,
      event.sessionId ?? null,
    ]),
  );
}

@Injectable()
export class WorkLogRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async authenticateToken(authorization: string): Promise<WorkLogPrincipal> {
    const token = /^Bearer (twl_[A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
    if (!token)
      throw new ORPCError("UNAUTHORIZED", {
        message: "Invalid work log token",
      });
    const tokenHash = hash(token);
    return this.database.transaction(async (tx) => {
      const row = await this.lockToken(tx, tokenHash);
      return { userId: row.userId, tokenHash };
    });
  }

  private async lockToken(tx: Transaction, tokenHash: string) {
    const [token] = await tx
      .select()
      .from(workLogTokens)
      .where(eq(workLogTokens.tokenHash, tokenHash))
      .for("share");
    if (
      !token ||
      token.revokedAt !== null ||
      !isAfter(token.expiresAt, new Date())
    ) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Invalid or expired work log token",
      });
    }
    return token;
  }

  private async authorized<T>(
    principal: WorkLogPrincipal,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return this.database.transaction(async (tx) => {
      if (principal.tokenHash !== undefined) {
        const token = await this.lockToken(tx, principal.tokenHash);
        if (token.userId !== principal.userId)
          throw new ORPCError("UNAUTHORIZED");
      }
      return operation(tx);
    });
  }

  identity(principal: WorkLogPrincipal) {
    return this.authorized(principal, async () => ({
      userId: principal.userId,
    }));
  }

  ingest(principal: WorkLogPrincipal, input: WorkLogEventInput[]) {
    const events = input.map((event) => workLogEventInputSchema.parse(event));
    return this.authorized(principal, async (tx) => {
      const acceptedEventIds: string[] = [];
      const rejectedEvents: {
        id: string;
        reason: "future_timestamp" | "id_conflict" | "session_not_found";
      }[] = [];
      const now = new Date();
      for (const event of events) {
        const fingerprint = workLogFingerprint(event);
        const predicate = and(
          eq(workLogEntries.userId, principal.userId),
          eq(workLogEntries.id, event.id),
        );
        const [existing] = await tx
          .select()
          .from(workLogEntries)
          .where(predicate);
        if (existing) {
          if (existing.fingerprint === fingerprint)
            acceptedEventIds.push(event.id);
          else rejectedEvents.push({ id: event.id, reason: "id_conflict" });
          continue;
        }
        const occurredAt = parseISO(event.occurredAt);
        if (isAfter(occurredAt, addMinutes(now, 5))) {
          rejectedEvents.push({ id: event.id, reason: "future_timestamp" });
          continue;
        }
        if (event.sessionId !== undefined) {
          const [session] = await tx
            .select({ id: focusSessions.id })
            .from(focusSessions)
            .where(
              and(
                eq(focusSessions.id, event.sessionId),
                eq(focusSessions.userId, principal.userId),
              ),
            )
            .for("key share");
          if (!session) {
            rejectedEvents.push({ id: event.id, reason: "session_not_found" });
            continue;
          }
        }
        const [inserted] = await tx
          .insert(workLogEntries)
          .values({
            ...event,
            occurredAt,
            receivedAt: now,
            userId: principal.userId,
            fingerprint,
          })
          .onConflictDoNothing({
            target: [workLogEntries.userId, workLogEntries.id],
          })
          .returning({ id: workLogEntries.id });
        if (inserted) acceptedEventIds.push(event.id);
        else {
          const [concurrent] = await tx
            .select()
            .from(workLogEntries)
            .where(predicate);
          if (concurrent?.fingerprint === fingerprint)
            acceptedEventIds.push(event.id);
          else rejectedEvents.push({ id: event.id, reason: "id_conflict" });
        }
      }
      return { acceptedEventIds, rejectedEvents };
    });
  }

  list(principal: WorkLogPrincipal, rawInput: WorkLogListInput) {
    const input = workLogListInputSchema.parse(rawInput);
    return this.authorized(principal, async (tx) => {
      const limit = input.limit ?? 50;
      const before = input.before;
      const rows = await tx
        .select()
        .from(workLogEntries)
        .where(
          and(
            eq(workLogEntries.userId, principal.userId),
            input.from === undefined
              ? undefined
              : gte(workLogEntries.occurredAt, parseISO(input.from)),
            input.to === undefined
              ? undefined
              : lt(workLogEntries.occurredAt, parseISO(input.to)),
            before === undefined
              ? undefined
              : or(
                  lt(workLogEntries.occurredAt, parseISO(before.occurredAt)),
                  and(
                    eq(workLogEntries.occurredAt, parseISO(before.occurredAt)),
                    lt(workLogEntries.id, before.id),
                  ),
                ),
          ),
        )
        .orderBy(desc(workLogEntries.occurredAt), desc(workLogEntries.id))
        .limit(limit + 1);
      const entries: WorkLogEntry[] = rows.slice(0, limit).map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        receivedAt: row.receivedAt.toISOString(),
        source: row.source,
        sourceSessionId: row.sourceSessionId,
        kind: row.kind,
        summary: row.summary,
        ...(row.project === null ? {} : { project: row.project }),
        ...(row.sessionId === null ? {} : { sessionId: row.sessionId }),
      }));
      const last = entries.at(-1);
      return {
        entries,
        nextCursor:
          rows.length > limit && last
            ? { occurredAt: last.occurredAt, id: last.id }
            : null,
      };
    });
  }

  async createToken(userId: string, label: string) {
    const token = `twl_${randomBytes(32).toString("base64url")}`;
    const expiresAt = addHours(new Date(), 30 * 24);
    const [row] = await this.database
      .insert(workLogTokens)
      .values({ userId, label, tokenHash: hash(token), expiresAt })
      .returning({ id: workLogTokens.id });
    if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
    return { id: row.id, userId, token, expiresAt: expiresAt.toISOString() };
  }

  async listTokens(userId: string) {
    const rows = await this.database
      .select({
        id: workLogTokens.id,
        label: workLogTokens.label,
        createdAt: workLogTokens.createdAt,
        expiresAt: workLogTokens.expiresAt,
        revokedAt: workLogTokens.revokedAt,
      })
      .from(workLogTokens)
      .where(eq(workLogTokens.userId, userId))
      .orderBy(desc(workLogTokens.createdAt));
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
  }

  async revokeToken(userId: string, id: string) {
    // UPDATE waits for all in-flight operations holding this credential's share lock.
    const [row] = await this.database
      .update(workLogTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(workLogTokens.userId, userId), eq(workLogTokens.id, id)))
      .returning({ id: workLogTokens.id });
    if (!row)
      throw new ORPCError("NOT_FOUND", { message: "Work log token not found" });
    return { revoked: true as const };
  }
}
