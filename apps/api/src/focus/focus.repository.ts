import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/server";
import { createHash, randomBytes } from "node:crypto";
import type { AddFocusNoteInput, CreateFocusInput, FocusSession, TransitionFocusInput, UpdateRecapInput, WorkEvent, WorkEventInput } from "@repo/api-contract";
import type { Database } from "@repo/database";
import { focusCaptureTokens, focusSessions, focusTransitions, focusWorkEvents } from "@repo/database/schema";
import { addHours, addMinutes, isAfter, isBefore, isValid, parseISO, subHours } from "date-fns";
import { and, asc, desc, eq } from "drizzle-orm";
import { DATABASE } from "../database/database.constants.js";
import { buildFocusDetail, MAX_EVENTS, transitionState, validateEventTime } from "./focus-domain.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SessionRow = typeof focusSessions.$inferSelect;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const bySession = (sessionId: string) => eq(focusSessions.id, sessionId);

function serialize(row: SessionRow): FocusSession {
  return {id: row.id, intention: row.intention, status: row.status, elapsedMs: row.elapsedMs,
    revision: row.revision, recapText: row.recapText, recapRevision: row.recapRevision,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    runningSince: row.runningSince?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null};
}

@Injectable()
export class FocusRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private async lock(tx: Transaction, userId: string, sessionId: string): Promise<SessionRow> {
    const [session] = await tx.select().from(focusSessions).where(and(bySession(sessionId), eq(focusSessions.userId, userId))).for("update");
    if (session === undefined) throw new ORPCError("NOT_FOUND", {message: "Focus session not found"});
    return session;
  }

  async list(userId: string): Promise<FocusSession[]> {
    return (await this.database.select().from(focusSessions).where(eq(focusSessions.userId, userId)).orderBy(desc(focusSessions.createdAt)).limit(100)).map(serialize);
  }

  async create(userId: string, input: CreateFocusInput): Promise<FocusSession> {
    return this.database.transaction(async (tx) => {
      const now = new Date();
      const at = validateEventTime(input.occurredAt, now);
      const signature = fingerprint({action: "start", intention: input.intention, occurredAt: input.occurredAt});
      // Conflict-safe insertion also serializes concurrent creation/retry of the same ID.
      const [created] = await tx.insert(focusSessions).values({id: input.id, userId, intention: input.intention, status: "running", runningSince: at, createdAt: at, updatedAt: now}).onConflictDoNothing().returning();
      if (created !== undefined) {
        if (isBefore(at, subHours(now, 7 * 24))) throw new ORPCError("BAD_REQUEST", {message: "New sessions must start within the last seven days"});
        await tx.insert(focusTransitions).values({sessionId: created.id, commandId: input.commandId, action: "start", revision: 1, occurredAt: at, fingerprint: signature});
        return serialize(created);
      }
      const existing = await this.lock(tx, userId, input.id);
      const [command] = await tx.select().from(focusTransitions).where(and(eq(focusTransitions.sessionId, input.id), eq(focusTransitions.commandId, input.commandId)));
      if (command?.fingerprint !== signature) throw new ORPCError("CONFLICT", {message: "Session ID or command ID was already used"});
      return serialize(existing);
    });
  }

  async transition(userId: string, input: TransitionFocusInput): Promise<FocusSession> {
    return this.database.transaction(async (tx) => {
      const session = await this.lock(tx, userId, input.sessionId);
      const signature = fingerprint({action: input.action, occurredAt: input.occurredAt, expectedRevision: input.expectedRevision});
      const [duplicate] = await tx.select().from(focusTransitions).where(and(eq(focusTransitions.sessionId, input.sessionId), eq(focusTransitions.commandId, input.commandId)));
      if (duplicate !== undefined) {
        if (duplicate.fingerprint !== signature) throw new ORPCError("CONFLICT", {message: "Command ID was already used for a different command"});
        return serialize(session);
      }
      if (session.revision !== input.expectedRevision) throw new ORPCError("CONFLICT", {message: "The timer changed on another device; refresh before trying again"});
      const now = new Date();
      const at = validateEventTime(input.occurredAt, now);
      const [previous] = await tx.select().from(focusTransitions).where(eq(focusTransitions.sessionId, session.id)).orderBy(desc(focusTransitions.revision)).limit(1);
      if (previous === undefined) throw new Error("Focus session has no starting transition");
      const next = transitionState(serialize(session), input.action, at, previous.occurredAt);
      const [updated] = await tx.update(focusSessions).set({...next, updatedAt: now}).where(bySession(session.id)).returning();
      if (updated === undefined) throw new Error("Focus transition returned no session");
      await tx.insert(focusTransitions).values({sessionId: session.id, commandId: input.commandId, action: input.action, revision: next.revision, occurredAt: at, fingerprint: signature});
      return serialize(updated);
    });
  }

  private async detail(tx: Transaction, session: SessionRow) {
    const transitions = await tx.select().from(focusTransitions).where(eq(focusTransitions.sessionId, session.id)).orderBy(asc(focusTransitions.revision));
    const rows = await tx.select().from(focusWorkEvents).where(eq(focusWorkEvents.sessionId, session.id)).orderBy(asc(focusWorkEvents.occurredAt), asc(focusWorkEvents.id));
    const events: WorkEvent[] = rows.map((row) => ({id: row.id, source: row.source, sourceSessionId: row.sourceSessionId, kind: row.kind, summary: row.summary, evidenceUrl: row.evidenceUrl, occurredAt: row.occurredAt.toISOString()}));
    return buildFocusDetail(serialize(session), transitions, events, new Date());
  }

  async get(userId: string, sessionId: string) {
    // Same session lock gives a coherent recap snapshot and bounds concurrent ingestion.
    return this.database.transaction(async (tx) => this.detail(tx, await this.lock(tx, userId, sessionId)));
  }

  async updateRecap(userId: string, input: UpdateRecapInput) {
    return this.database.transaction(async (tx) => {
      const session = await this.lock(tx, userId, input.sessionId);
      // A lost response may be retried without losing another editor's changes.
      if (session.recapRevision !== input.expectedRevision) {
        if (session.recapRevision === input.expectedRevision + 1 && session.recapText === input.text) return this.detail(tx, session);
        throw new ORPCError("CONFLICT", {message: "The recap changed on another device; reload it before saving"});
      }
      const [updated] = await tx.update(focusSessions).set({recapText: input.text, recapRevision: session.recapRevision + 1, updatedAt: new Date()}).where(bySession(session.id)).returning();
      if (updated === undefined) throw new Error("Recap update returned no session");
      return this.detail(tx, updated);
    });
  }

  private async insertEvents(tx: Transaction, session: SessionRow, events: WorkEvent[], partial = false) {
    const now = new Date();
    const existing = await tx.select({id: focusWorkEvents.id, fingerprint: focusWorkEvents.fingerprint}).from(focusWorkEvents).where(eq(focusWorkEvents.sessionId, session.id));
    const signatures = new Map(existing.map((event) => [event.id, event.fingerprint]));
    type RejectionReason = "outside_session" | "future_timestamp" | "id_conflict" | "session_limit";
    const rejectedEvents: {id: string; reason: RejectionReason}[] = [];
    const acceptedEventIds: string[] = [];
    const incoming = new Map<string, {event: WorkEvent; signature: string}>();
    const conflicts = new Set<string>();
    for (const event of events) {
      const signature = fingerprint({source: event.source, sourceSessionId: event.sourceSessionId, kind: event.kind, summary: event.summary, evidenceUrl: event.evidenceUrl, occurredAt: event.occurredAt});
      const prior = incoming.get(event.id);
      if (prior !== undefined && prior.signature !== signature) conflicts.add(event.id);
      incoming.set(event.id, {event, signature});
    }
    const reject = (id: string, reason: RejectionReason) => {
      if (!partial) throw new ORPCError(reason === "id_conflict" ? "CONFLICT" : "BAD_REQUEST", {
        message: reason === "id_conflict" ? "Event ID was already used for different evidence" : "Evidence is outside the permitted time or session limit",
      });
      rejectedEvents.push({id, reason});
    };
    for (const {event, signature} of incoming.values()) {
      const previous = signatures.get(event.id);
      if (conflicts.has(event.id) || (previous !== undefined && previous !== signature)) {
        reject(event.id, "id_conflict");
        continue;
      }
      if (previous !== undefined) {
        acceptedEventIds.push(event.id);
        continue;
      }
      const at = parseISO(event.occurredAt);
      if (!isValid(at) || isAfter(at, addMinutes(now, 5))) {
        reject(event.id, "future_timestamp");
        continue;
      }
      if (event.source === "codex" && (isBefore(at, session.createdAt) || (session.completedAt !== null && isAfter(at, session.completedAt)))) {
        reject(event.id, "outside_session");
        continue;
      }
      if (signatures.size >= MAX_EVENTS) {
        reject(event.id, "session_limit");
        continue;
      }
      await tx.insert(focusWorkEvents).values({...event, sessionId: session.id, occurredAt: at, fingerprint: signature});
      signatures.set(event.id, signature);
      acceptedEventIds.push(event.id);
    }
    return {acceptedEventIds, rejectedEvents};
  }

  async addNote(userId: string, input: AddFocusNoteInput) {
    return this.database.transaction(async (tx) => {
      const session = await this.lock(tx, userId, input.sessionId);
      await this.insertEvents(tx, session, [{id: input.id, source: "manual", sourceSessionId: session.id, kind: "note", summary: input.summary, evidenceUrl: input.evidenceUrl ?? null, occurredAt: input.occurredAt}]);
      return this.detail(tx, session);
    });
  }

  async createCaptureToken(userId: string, sessionId: string) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx, userId, sessionId);
      const token = `timer_capture_${randomBytes(32).toString("base64url")}`;
      const now = new Date();
      const expiresAt = addHours(now, 24);
      const values = {sessionId, tokenHash: tokenHash(token), expiresAt, createdAt: now};
      await tx.insert(focusCaptureTokens).values(values).onConflictDoUpdate({target: focusCaptureTokens.sessionId, set: values});
      return {token, expiresAt: expiresAt.toISOString()};
    });
  }

  async revokeCaptureToken(userId: string, sessionId: string) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx, userId, sessionId);
      await tx.delete(focusCaptureTokens).where(eq(focusCaptureTokens.sessionId, sessionId));
      return {revoked: true as const};
    });
  }

  async ingest(authorization: string | undefined, sessionId: string, inputs: WorkEventInput[]) {
    const match = /^Bearer (timer_capture_[A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
    if (match?.[1] === undefined) throw new ORPCError("UNAUTHORIZED", {message: "A valid session capture token is required"});
    const hash = tokenHash(match[1]);
    return this.database.transaction(async (tx) => {
      const [session] = await tx.select().from(focusSessions).where(bySession(sessionId)).for("update");
      const [credential] = await tx.select().from(focusCaptureTokens).where(and(eq(focusCaptureTokens.sessionId, sessionId), eq(focusCaptureTokens.tokenHash, hash)));
      if (session === undefined || credential === undefined || !isAfter(credential.expiresAt, new Date())) throw new ORPCError("UNAUTHORIZED", {message: "Capture token is invalid, expired, or revoked"});
      return this.insertEvents(tx, session, inputs.map((input) => ({...input, evidenceUrl: input.evidenceUrl ?? null})), true);
    });
  }
}
