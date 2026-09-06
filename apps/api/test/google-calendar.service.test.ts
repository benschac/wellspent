import { describe, expect, it, mock } from "bun:test";
import { randomBytes } from "node:crypto";
import { CryptoService } from "../src/crypto/crypto.service.js";
import type { GoogleCalendarConfig } from "../src/google-calendar/google-calendar.config.js";
import type { GoogleCalendarRepository } from "../src/google-calendar/google-calendar.repository.js";
import { GoogleCalendarService } from "../src/google-calendar/google-calendar.service.js";
import type { GoogleCalendarClient } from "../src/google-calendar/google-calendar.types.js";

function createSubject() {
  const config = {
    assertEnabled: mock(() => undefined),
    encryptionKey: randomBytes(32),
  } as unknown as GoogleCalendarConfig;
  const crypto = new CryptoService();
  const buildAuthorizationUrl = mock(() => "https://accounts.google.com/auth");
  const enqueuePullChanges = mock(() => Promise.resolve());
  const createOauthState = mock(() => Promise.resolve());
  const repository = {
    createOauthState,
    enqueuePullChanges,
    findSubscriptionByChannelId: mock(() => Promise.resolve(undefined)),
  } as unknown as GoogleCalendarRepository;
  const client = {
    buildAuthorizationUrl,
  } as unknown as GoogleCalendarClient;
  const service = new GoogleCalendarService(client, config, crypto, repository);

  return {
    buildAuthorizationUrl,
    createOauthState,
    crypto,
    enqueuePullChanges,
    repository,
    service,
  };
}

describe("GoogleCalendarService", () => {
  it("stores a one-time OAuth state and returns the authorization URL", async () => {
    const subject = createSubject();

    await expect(
      subject.service.beginAuthorization("user-id"),
    ).resolves.toEqual({
      authorizationUrl: "https://accounts.google.com/auth",
    });
    expect(subject.createOauthState).toHaveBeenCalledTimes(1);
    expect(subject.buildAuthorizationUrl).toHaveBeenCalledTimes(1);
  });

  it("authenticates webhook channel metadata before enqueueing work", async () => {
    const subject = createSubject();
    const channelToken = "secret-channel-token";
    const subscription = {
      connectionId: "connection-id",
      resourceId: "resource-id",
      channelTokenHash: subject.crypto.sha256(channelToken),
    };
    Object.assign(subject.repository, {
      findSubscriptionByChannelId: mock(() => Promise.resolve(subscription)),
    });

    await subject.service.receiveNotification({
      channelId: "channel-id",
      channelToken,
      messageNumber: "2",
      resourceId: "resource-id",
      resourceState: "exists",
    });

    expect(subject.enqueuePullChanges).toHaveBeenCalledWith({
      channelId: "channel-id",
      connectionId: "connection-id",
      messageNumber: "2",
      resourceState: "exists",
    });
  });
});
