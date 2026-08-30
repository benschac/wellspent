import { Inject, Injectable } from "@nestjs/common";
import type { Database } from "@repo/database";
import { profiles } from "@repo/database/schema";
import { eq, sql } from "drizzle-orm";
import { DATABASE } from "../database/database.constants.js";

export type ProfileRow = typeof profiles.$inferSelect;

export interface ProfileChanges {
  avatarUrl?: string | null;
  displayName?: string | null;
  timeZone?: string | null;
}

@Injectable()
export class ProfileRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findByUserId(userId: string): Promise<ProfileRow | null> {
    const [profile] = await this.database
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    return profile ?? null;
  }

  async upsert(userId: string, changes: ProfileChanges): Promise<ProfileRow> {
    const [profile] = await this.database
      .insert(profiles)
      .values({ id: userId, ...changes })
      .onConflictDoUpdate({
        target: profiles.id,
        set: { ...changes, updatedAt: sql`now()` },
      })
      .returning();

    if (profile === undefined) {
      throw new Error("Profile upsert returned no row");
    }

    return profile;
  }
}
