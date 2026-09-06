import { describe, expect, it, mock } from "bun:test";
import { randomBytes } from "node:crypto";
import { CryptoService } from "../src/crypto/crypto.service.js";
import {
  GOOGLE_SCOPES,
  type GoogleConfig,
} from "../src/google/google.config.js";
import type {
  GoogleConnection,
  GoogleRepository,
} from "../src/google/google.repository.js";
import type { GoogleOAuthClient } from "../src/google/google-oauth.client.js";
import { GoogleOAuthService } from "../src/google/google-oauth.service.js";

function fixture() {
  const crypto = new CryptoService();
  const key = randomBytes(32);
  const config = {
    assertEnabled: mock(() => {}),
    encryptionKey: key,
  } as unknown as GoogleConfig;
  let connection: GoogleConnection | undefined;
  let state:
    | {
        stateHash: string;
        integration: string;
        userId: string;
        encryptedCodeVerifier: string;
        expiresAt: Date;
      }
    | undefined;
  const scopes = ["openid", GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.sheets];
  const client = {
    authorizationUrl: mock(() => "https://accounts.google.com/auth"),
    exchange: mock(async () => ({
      subject: "google-user",
      accessToken: "access",
      refreshToken: "refresh" as string | undefined,
      scopes,
    })),
    refresh: mock(async () => "access"),
    subject: mock(async () => "google-user"),
    inspectRefreshToken: mock(async () => ({ sub: "google-user", scopes })),
    revoke: mock(async () => {}),
  };
  const repository = {
    find: mock(async () => connection),
    createState: mock(async (input: NonNullable<typeof state>) => {
      state = input;
    }),
    consumeState: mock(async (hash: string, integration: string) => {
      if (
        !state ||
        state.stateHash !== hash ||
        state.integration !== integration ||
        state.expiresAt <= new Date()
      )
        return undefined;
      const saved = state;
      state = undefined;
      return saved;
    }),
    save: mock(
      async (input: {
        userId: string;
        googleSubject: string;
        encryptedRefreshToken: string;
        grantedScopes: string[];
      }) => {
        connection = {
          ...input,
          reconnectRequired: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    ),
    markReconnectRequired: mock(async () => {}),
    deleteAll: mock(async () => {
      connection = undefined;
    }),
  };
  const service = new GoogleOAuthService(
    client as unknown as GoogleOAuthClient,
    config,
    crypto,
    repository as unknown as GoogleRepository,
  );
  const seed = (subject: string | null = "google-user") => {
    connection = {
      userId: "user",
      googleSubject: subject,
      encryptedRefreshToken: crypto.encryptAes256Gcm("old-refresh", key),
      grantedScopes: [GOOGLE_SCOPES.calendar],
      reconnectRequired: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  const prepare = async () => {
    await service.beginAuthorization("user", "sheets");
    // Recover the raw state only from the authorization URL builder arguments.
    const call = client.authorizationUrl.mock.calls[0] as unknown as [
      { state: string; scopes: string[]; codeChallenge: string },
    ];
    return { state: call[0].state, code: "code" };
  };
  return {
    service,
    client,
    repository,
    crypto,
    key,
    seed,
    prepare,
    getState: () => state,
  };
}

describe("shared Google OAuth", () => {
  it("stores hashed one-time state and encrypted PKCE while retaining Calendar scopes", async () => {
    const f = fixture();
    f.seed();
    const input = await f.prepare();
    expect(f.getState()?.stateHash).toBe(f.crypto.sha256(input.state));
    expect(f.getState()?.encryptedCodeVerifier.startsWith("v1.")).toBe(true);
    expect(f.client.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: expect.arrayContaining([
          GOOGLE_SCOPES.calendar,
          GOOGLE_SCOPES.sheets,
          "openid",
        ]),
      }),
    );
    await f.service.completeAuthorization("sheets", input);
    expect(f.repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ googleSubject: "google-user", userId: "user" }),
    );
    const saved = f.repository.save.mock.calls[0]?.[0];
    expect(
      saved && f.crypto.decryptAes256Gcm(saved.encryptedRefreshToken, f.key),
    ).toBe("refresh");
    await expect(
      f.service.completeAuthorization("sheets", input),
    ).rejects.toThrow("invalid or expired");
    expect(f.client.exchange).toHaveBeenCalledTimes(1);
  });
  it("rejects state intended for another integration before token exchange", async () => {
    const f = fixture();
    const input = await f.prepare();
    await expect(
      f.service.completeAuthorization("calendar", input),
    ).rejects.toThrow("invalid or expired");
    expect(f.client.exchange).not.toHaveBeenCalled();
  });
  it("rejects expired state", async () => {
    const f = fixture();
    const input = await f.prepare();
    const state = f.getState();
    if (state) state.expiresAt = new Date(0);
    await expect(
      f.service.completeAuthorization("sheets", input),
    ).rejects.toThrow("invalid or expired");
    expect(f.client.exchange).not.toHaveBeenCalled();
  });
  it("rejects changing the Google account beneath Calendar", async () => {
    const f = fixture();
    f.seed("different-account");
    const input = await f.prepare();
    await expect(
      f.service.completeAuthorization("sheets", input),
    ).rejects.toThrow("same Google account");
    expect(f.repository.save).not.toHaveBeenCalled();
  });
  it("verifies migrated Calendar account identity before adding Sheets", async () => {
    const f = fixture();
    f.seed(null);
    const input = await f.prepare();
    await f.service.completeAuthorization("sheets", input);
    expect(f.client.subject).toHaveBeenCalledWith("old-refresh");
  });
  it("rejects partial consent without replacing existing credentials", async () => {
    const f = fixture();
    f.seed();
    const input = await f.prepare();
    f.client.exchange.mockResolvedValueOnce({
      accessToken: "access",
      refreshToken: "new",
      subject: "google-user",
      scopes: ["openid"],
    });
    await expect(
      f.service.completeAuthorization("sheets", input),
    ).rejects.toThrow("requested permission");
    expect(f.repository.save).not.toHaveBeenCalled();
  });
  it("retains an existing refresh token only when it carries the combined scopes", async () => {
    const f = fixture();
    f.seed();
    const input = await f.prepare();
    f.client.exchange.mockResolvedValueOnce({
      accessToken: "access",
      refreshToken: undefined,
      subject: "google-user",
      scopes: ["openid", GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.sheets],
    });
    await f.service.completeAuthorization("sheets", input);
    expect(f.client.inspectRefreshToken).toHaveBeenCalledWith("old-refresh");
  });
  it("does not save a refresh token with insufficient permissions", async () => {
    const f = fixture();
    const input = await f.prepare();
    f.client.inspectRefreshToken.mockResolvedValueOnce({
      sub: "google-user",
      scopes: ["openid"],
    });
    await expect(
      f.service.completeAuthorization("sheets", input),
    ).rejects.toThrow("offline access does not include");
    expect(f.repository.save).not.toHaveBeenCalled();
  });
  it("requires offline access on first connect", async () => {
    const f = fixture();
    const input = await f.prepare();
    f.client.exchange.mockResolvedValueOnce({
      accessToken: "access",
      refreshToken: undefined,
      subject: "google-user",
      scopes: ["openid", GOOGLE_SCOPES.sheets],
    });
    await expect(
      f.service.completeAuthorization("sheets", input),
    ).rejects.toThrow("offline access");
    expect(f.repository.save).not.toHaveBeenCalled();
  });
  it("marks invalid refresh grants reconnect-required without exposing SDK secrets", async () => {
    const f = fixture();
    f.seed();
    f.client.refresh.mockRejectedValueOnce({
      response: { data: { error: "invalid_grant" } },
      config: { refresh_token: "secret" },
    });
    await expect(f.service.getAccessToken("user", "calendar")).rejects.toThrow(
      "reconnect your Google account",
    );
    expect(f.repository.markReconnectRequired).toHaveBeenCalledTimes(1);
  });
  it("does not invalidate credentials for transient provider failures", async () => {
    const f = fixture();
    f.seed();
    f.client.refresh.mockRejectedValueOnce(new Error("secret request details"));
    await expect(f.service.getAccessToken("user", "calendar")).rejects.toThrow(
      "temporarily unavailable",
    );
    expect(f.repository.markReconnectRequired).not.toHaveBeenCalled();
  });
  it("rejects API access without the requested scope", async () => {
    const f = fixture();
    f.seed();
    await expect(f.service.getAccessToken("user", "sheets")).rejects.toThrow(
      "Connect Google sheets",
    );
    expect(f.client.refresh).not.toHaveBeenCalled();
  });
  it("revokes the grant only through explicit all-Google disconnect", async () => {
    const f = fixture();
    f.seed();
    await f.service.disconnectAll("user");
    expect(f.client.revoke).toHaveBeenCalledWith("old-refresh");
    expect(f.repository.deleteAll).toHaveBeenCalledWith("user");
  });
  it("cleans up an already-revoked grant but preserves state on transient revocation failure", async () => {
    const f = fixture();
    f.seed();
    f.client.revoke.mockRejectedValueOnce({
      response: { status: 400, data: { error: "invalid_token" } },
    });
    await f.service.disconnectAll("user");
    expect(f.repository.deleteAll).toHaveBeenCalledTimes(1);
    f.seed();
    f.client.revoke.mockRejectedValueOnce(new Error("network failure"));
    await expect(f.service.disconnectAll("user")).rejects.toThrow(
      "retry disconnect",
    );
    expect(f.repository.deleteAll).toHaveBeenCalledTimes(1);
  });
});
