import { describe, expect, it, mock } from "bun:test";
import type { Database } from "@repo/database";
import { ProfileRepository } from "../src/profile/profile.repository.js";

const profileRow = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Focus user",
  avatarUrl: null,
  timeZone: "America/New_York",
  createdAt: new Date("2026-08-30T12:00:00.000Z"),
  updatedAt: new Date("2026-08-30T12:00:00.000Z"),
};

describe("ProfileRepository", () => {
  it("returns null without creating a profile when no row exists", async () => {
    const limit = mock(() => Promise.resolve([]));
    const where = mock(() => ({ limit }));
    const from = mock(() => ({ where }));
    const select = mock(() => ({ from }));
    const database = { select } as unknown as Database;
    const repository = new ProfileRepository(database);

    await expect(repository.findByUserId(profileRow.id)).resolves.toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(1);
  });

  it("atomically creates or updates the authenticated user's profile", async () => {
    const returning = mock(() => Promise.resolve([profileRow]));
    const onConflictDoUpdate = mock(() => ({ returning }));
    const values = mock(() => ({ onConflictDoUpdate }));
    const insert = mock(() => ({ values }));
    const database = { insert } as unknown as Database;
    const repository = new ProfileRepository(database);

    await expect(
      repository.upsert(profileRow.id, {
        displayName: profileRow.displayName,
        timeZone: profileRow.timeZone,
      }),
    ).resolves.toEqual(profileRow);

    expect(values).toHaveBeenCalledWith({
      id: profileRow.id,
      displayName: profileRow.displayName,
      timeZone: profileRow.timeZone,
    });
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(returning).toHaveBeenCalledTimes(1);
  });
});
