import { Injectable } from "@nestjs/common";
import type { Profile, UpdateProfileInput } from "@repo/api-contract";
import {
  type ProfileChanges,
  ProfileRepository,
  type ProfileRow,
} from "./profile.repository.js";

@Injectable()
export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  async get(userId: string): Promise<Profile> {
    const profile = await this.repository.findByUserId(userId);
    if (profile === null) {
      throw new Error("Profile is missing for the authenticated user");
    }

    return this.serialize(profile);
  }

  async update(userId: string, input: UpdateProfileInput): Promise<Profile> {
    const changes: ProfileChanges = {};

    if (input.avatarUrl !== undefined) {
      changes.avatarUrl = input.avatarUrl;
    }
    if (input.displayName !== undefined) {
      changes.displayName = input.displayName;
    }
    if (input.timeZone !== undefined) {
      changes.timeZone = input.timeZone;
    }

    return this.serialize(await this.repository.upsert(userId, changes));
  }

  private serialize(profile: ProfileRow): Profile {
    return {
      id: profile.id,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      timeZone: profile.timeZone,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
