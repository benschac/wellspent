import { describe, expect, it, mock } from "bun:test";
import type { ProfileRepository } from "../src/profile/profile.repository.js";
import { ProfileService } from "../src/profile/profile.service.js";

const profileRow = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Focus user",
  avatarUrl: null,
  timeZone: "America/New_York",
  createdAt: new Date("2026-08-30T12:00:00.000Z"),
  updatedAt: new Date("2026-08-30T12:05:00.000Z"),
};

describe("ProfileService", () => {
  it("returns the profile provisioned for the authenticated user", async () => {
    const findByUserId = mock(() => Promise.resolve(profileRow));
    const upsert = mock(() => Promise.resolve(profileRow));
    const repository = { findByUserId, upsert } as unknown as ProfileRepository;
    const service = new ProfileService(repository);

    await expect(service.get(profileRow.id)).resolves.toEqual({
      id: profileRow.id,
      displayName: profileRow.displayName,
      avatarUrl: null,
      timeZone: profileRow.timeZone,
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:05:00.000Z",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("surfaces a broken profile provisioning invariant", async () => {
    const repository = {
      findByUserId: mock(() => Promise.resolve(null)),
      upsert: mock(() => Promise.resolve(profileRow)),
    } as unknown as ProfileRepository;
    const service = new ProfileService(repository);

    await expect(service.get(profileRow.id)).rejects.toThrow(
      "Profile is missing for the authenticated user",
    );
  });

  it("passes only supplied fields to the atomic upsert and serializes timestamps", async () => {
    const upsert = mock(() => Promise.resolve(profileRow));
    const repository = {
      findByUserId: mock(() => Promise.resolve(null)),
      upsert,
    } as unknown as ProfileRepository;
    const service = new ProfileService(repository);

    await expect(
      service.update(profileRow.id, {
        displayName: profileRow.displayName,
        avatarUrl: null,
      }),
    ).resolves.toEqual({
      id: profileRow.id,
      displayName: profileRow.displayName,
      avatarUrl: null,
      timeZone: profileRow.timeZone,
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:05:00.000Z",
    });
    expect(upsert).toHaveBeenCalledWith(profileRow.id, {
      displayName: profileRow.displayName,
      avatarUrl: null,
    });
  });
});
