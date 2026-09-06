import { describe, expect, it, mock } from "bun:test";
import { randomBytes } from "node:crypto";
import { CryptoService } from "../src/crypto/crypto.service.js";
import type { GoogleRepository } from "../src/google/google.repository.js";
import type { GoogleOAuthService } from "../src/google/google-oauth.service.js";
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
  const beginAuthorization = mock(() =>
    Promise.resolve({ authorizationUrl: "https://accounts.google.com/auth" }),
  );
  const oauth = {
    beginAuthorization,
    getAccessToken: mock(() => Promise.resolve("shared-access-token")),
  } as unknown as GoogleOAuthService;
  const googleRepository = {
    cancelStates: mock(async () => {}),
  } as unknown as GoogleRepository;
  const service = new GoogleCalendarService(
    client,
    config,
    crypto,
    repository,
    oauth,
    googleRepository,
  );

  return {
    buildAuthorizationUrl,
    createOauthState,
    crypto,
    enqueuePullChanges,
    repository,
    service,
    beginAuthorization,
    client,
    oauth,
  };
}

describe("GoogleCalendarService", () => {
  it("delegates Calendar authorization to the shared Google credential owner", async () => {
    const subject = createSubject();

    await expect(
      subject.service.beginAuthorization("user-id"),
    ).resolves.toEqual({
      authorizationUrl: "https://accounts.google.com/auth",
    });
    expect(subject.beginAuthorization).toHaveBeenCalledWith(
      "user-id",
      "calendar",
    );
    expect(subject.createOauthState).not.toHaveBeenCalled();
    expect(subject.buildAuthorizationUrl).not.toHaveBeenCalled();
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

  it("disconnects Calendar without revoking the shared Google grant", async () => {
    const subject = createSubject();
    const revokeToken = mock(() => Promise.resolve());
    const stopWatch = mock(() => Promise.resolve());
    const deleteConnection = mock(() => Promise.resolve());
    Object.assign(subject.client, { stopWatch, revokeToken });
    Object.assign(subject.repository, {
      findConnectionByUserId: mock(() =>
        Promise.resolve({ id: "connection-id" }),
      ),
      findSubscriptionByConnectionId: mock(() =>
        Promise.resolve({ channelId: "channel", resourceId: "resource" }),
      ),
      deleteConnection,
    });
    await subject.service.disconnect("user-id");
    expect(subject.oauth.getAccessToken).toHaveBeenCalledWith(
      "user-id",
      "calendar",
    );
    expect(stopWatch).toHaveBeenCalledWith({
      accessToken: "shared-access-token",
      channelId: "channel",
      resourceId: "resource",
    });
    expect(deleteConnection).toHaveBeenCalledWith("connection-id");
    expect(revokeToken).not.toHaveBeenCalled();
  });
});
