import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@repo/database";
import { focusSessions } from "@repo/database/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { DATABASE } from "../database/database.constants.js";

@Injectable()
export class GoogleSheetsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  findSessions(userId: string, sessionIds: string[]) {
    return this.db
      .select({
        id: focusSessions.id,
        intention: focusSessions.intention,
        status: focusSessions.status,
        elapsedMs: focusSessions.elapsedMs,
        createdAt: focusSessions.createdAt,
        completedAt: focusSessions.completedAt,
        recapText: focusSessions.recapText,
      })
      .from(focusSessions)
      .where(
        and(
          eq(focusSessions.userId, userId),
          inArray(focusSessions.id, sessionIds),
        ),
      )
      .orderBy(asc(focusSessions.createdAt), asc(focusSessions.id));
  }
}
