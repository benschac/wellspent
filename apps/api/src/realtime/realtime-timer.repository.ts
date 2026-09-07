import { Inject, Injectable } from "@nestjs/common";
import type {
  RealtimeTimerCommand,
  RealtimeTimerState,
} from "@repo/api-contract";
import type { Database } from "@repo/database";
import { realtimeTimerState } from "@repo/database/schema";
import { eq } from "drizzle-orm";
import { DATABASE } from "../database/database.constants.js";
import { transitionRealtimeTimer } from "./realtime-timer-state.js";

function serialize(
  row: typeof realtimeTimerState.$inferSelect,
): RealtimeTimerState {
  return {
    elapsedMs: row.elapsedMs,
    isRunning: row.isRunning,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class RealtimeTimerRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async get(): Promise<RealtimeTimerState> {
    // Never seed over a stored timer when a process starts or a client connects.
    await this.database
      .insert(realtimeTimerState)
      .values({ id: 1 })
      .onConflictDoNothing();
    const [row] = await this.database
      .select()
      .from(realtimeTimerState)
      .where(eq(realtimeTimerState.id, 1));
    if (row === undefined) throw new Error("Shared timer state is missing");
    return serialize(row);
  }

  async apply(command: RealtimeTimerCommand) {
    return this.database.transaction(async (tx) => {
      await tx
        .insert(realtimeTimerState)
        .values({ id: 1 })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(realtimeTimerState)
        .where(eq(realtimeTimerState.id, 1))
        .for("update");
      if (row === undefined) throw new Error("Shared timer state is missing");

      // Sample time after acquiring the lock. Concurrent commands must reduce
      // the latest committed state, including elapsed time during API downtime.
      const previous = serialize(row);
      const state = transitionRealtimeTimer(previous, command, Date.now());
      const changed = state.revision !== previous.revision;
      if (changed) {
        await tx
          .update(realtimeTimerState)
          .set({ ...state, updatedAt: new Date(state.updatedAt) })
          .where(eq(realtimeTimerState.id, 1));
      }
      return { state, changed };
    });
  }
}
