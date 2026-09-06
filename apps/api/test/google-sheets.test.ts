import { describe, expect, it, mock, spyOn } from "bun:test";
import { sheets_v4 } from "@googleapis/sheets";
import { ValidationPipe } from "@nestjs/common";
import { validateEnvironment } from "../src/config/environment.js";
import {
  GOOGLE_SCOPES,
  type GoogleConfig,
} from "../src/google/google.config.js";
import type { GoogleRepository } from "../src/google/google.repository.js";
import { GoogleCallbackQueryDto } from "../src/google/google-callback-query.dto.js";
import { GoogleOAuthClient } from "../src/google/google-oauth.client.js";
import type { GoogleOAuthService } from "../src/google/google-oauth.service.js";
import { GoogleSheetsClient } from "../src/google-sheets/google-sheets.client.js";
import type { GoogleSheetsRepository } from "../src/google-sheets/google-sheets.repository.js";
import { GoogleSheetsService } from "../src/google-sheets/google-sheets.service.js";

const id = "10000000-0000-4000-8000-000000000001";
function fixture() {
  const session = {
    id,
    intention: '=IMPORTXML("example")',
    status: "completed",
    elapsedMs: 61500,
    createdAt: new Date("2026-09-06T12:00:00Z"),
    completedAt: new Date("2026-09-06T12:01:01.500Z"),
    recapText: "Wrote tests",
  };
  const repository = { findSessions: mock(async () => [session]) };
  const google = {
    sheetsEnabled: mock(async () => true),
    disableSheets: mock(async () => {}),
    enableSheets: mock(async () => {}),
  };
  const oauth = {
    getAccessToken: mock(async () => "access"),
    status: mock(async () => ({ authorized: true, reconnectRequired: false })),
    disconnectAll: mock(async () => {}),
    completeAuthorization: mock(async () => ({
      userId: "user",
      accessToken: "access",
    })),
  };
  const client = {
    createSpreadsheet: mock(async () => ({
      spreadsheetId: "sheet",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet/edit",
    })),
  };
  const config = { assertEnabled: mock(() => {}) };
  const service = new GoogleSheetsService(
    config as unknown as GoogleConfig,
    oauth as unknown as GoogleOAuthService,
    google as unknown as GoogleRepository,
    repository as unknown as GoogleSheetsRepository,
    client as unknown as GoogleSheetsClient,
  );
  return { service, repository, google, oauth, client, session };
}

describe("Google Sheets export", () => {
  it("exports only the user's selected completed sessions with durable elapsed time", async () => {
    const f = fixture();
    const result = await f.service.exportSessions("user", { sessionIds: [id] });
    expect(f.repository.findSessions).toHaveBeenCalledWith("user", [id]);
    expect(f.oauth.getAccessToken).toHaveBeenCalledWith("user", "sheets");
    expect(f.client.createSpreadsheet).toHaveBeenCalledWith(
      "access",
      expect.stringContaining("Focus Timer"),
      [
        [
          "Session ID",
          "Intention",
          "Started at (UTC)",
          "Completed at (UTC)",
          "Duration (seconds)",
          "Recap",
        ],
        [
          id,
          f.session.intention,
          "2026-09-06T12:00:00.000Z",
          "2026-09-06T12:01:01.500Z",
          61.5,
          "Wrote tests",
        ],
      ],
    );
    expect(result.exportedSessionCount).toBe(1);
  });
  it("rejects missing or other-user IDs before calling Google", async () => {
    const f = fixture();
    f.repository.findSessions.mockResolvedValueOnce([]);
    await expect(
      f.service.exportSessions("user", { sessionIds: [id] }),
    ).rejects.toThrow("not found");
    expect(f.client.createSpreadsheet).not.toHaveBeenCalled();
    expect(f.oauth.getAccessToken).not.toHaveBeenCalled();
  });
  it("rejects running sessions", async () => {
    const f = fixture();
    f.session.status = "running";
    await expect(
      f.service.exportSessions("user", { sessionIds: [id] }),
    ).rejects.toThrow("Only completed");
    expect(f.client.createSpreadsheet).not.toHaveBeenCalled();
  });
  it("rejects oversized exports before refreshing credentials or calling Sheets", async () => {
    const f = fixture();
    f.session.recapText = "x".repeat(1_000_001);
    await expect(
      f.service.exportSessions("user", { sessionIds: [id] }),
    ).rejects.toThrow("Export is too large");
    expect(f.oauth.getAccessToken).not.toHaveBeenCalled();
    expect(f.client.createSpreadsheet).not.toHaveBeenCalled();
  });
  it("rejects duplicates, oversized selections, malformed UUIDs and user-supplied rows", async () => {
    const f = fixture();
    for (const input of [
      { sessionIds: [] },
      { sessionIds: [id, id] },
      { sessionIds: ["bad"] },
      { sessionIds: Array(501).fill(id) },
      { sessionIds: [id], userId: "other" },
      { sessionIds: [id], rows: [["arbitrary"]] },
    ]) {
      await expect(f.service.exportSessions("user", input)).rejects.toThrow(
        "unique session UUIDs",
      );
    }
    expect(f.repository.findSessions).not.toHaveBeenCalled();
  });
  it("blocks export after Sheets disconnect even if shared authorization remains", async () => {
    const f = fixture();
    f.google.sheetsEnabled.mockResolvedValueOnce(false);
    await expect(
      f.service.exportSessions("user", { sessionIds: [id] }),
    ).rejects.toThrow("Connect Google Sheets");
    expect(f.repository.findSessions).not.toHaveBeenCalled();
  });
  it("disconnects Sheets without revoking Calendar's grant", async () => {
    const f = fixture();
    await f.service.disconnect("user");
    expect(f.google.disableSheets).toHaveBeenCalledWith("user");
    expect(f.oauth.disconnectAll).not.toHaveBeenCalled();
  });
  it("enables Sheets for the user bound to OAuth state", async () => {
    const f = fixture();
    await f.service.callback({ state: "state", code: "code" });
    expect(f.google.enableSheets).toHaveBeenCalledWith("user");
  });
  it("creates a populated spreadsheet in one SDK request with literal cells and no retries", async () => {
    const create = spyOn(sheets_v4.Resource$Spreadsheets.prototype, "create");
    create.mockResolvedValue({ data: { spreadsheetId: "sheet" } } as never);
    try {
      const result = await new GoogleSheetsClient().createSpreadsheet(
        "access",
        "Export",
        [["=1+1", 60, true]],
      );
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            sheets: [
              expect.objectContaining({
                data: [
                  {
                    rowData: [
                      {
                        values: [
                          { userEnteredValue: { stringValue: "=1+1" } },
                          { userEnteredValue: { numberValue: 60 } },
                          { userEnteredValue: { boolValue: true } },
                        ],
                      },
                    ],
                  },
                ],
              }),
            ],
          }),
        }),
        expect.objectContaining({
          retry: false,
          timeout: 30000,
          headers: { authorization: "Bearer access" },
        }),
      );
      expect(result.spreadsheetUrl).toBe(
        "https://docs.google.com/spreadsheets/d/sheet/edit",
      );
    } finally {
      create.mockRestore();
    }
  });
  it("sanitizes Google SDK failures", async () => {
    const create = spyOn(sheets_v4.Resource$Spreadsheets.prototype, "create");
    create.mockRejectedValue(new Error("Bearer secret"));
    try {
      await expect(
        new GoogleSheetsClient().createSpreadsheet("secret", "Export", [["a"]]),
      ).rejects.toThrow("Google Sheets export failed");
    } finally {
      create.mockRestore();
    }
  });
});

describe("Google configuration and callback", () => {
  it("allows Sheets without enabling Calendar or requiring a webhook", () => {
    const env = validateEnvironment({
      DATABASE_URL: "postgresql://localhost/test",
      GOOGLE_SHEETS_ENABLED: "true",
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      GOOGLE_SHEETS_OAUTH_REDIRECT_URI:
        "http://localhost:3001/api/integrations/google-sheets/callback",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "key",
    });
    expect(env.GOOGLE_SHEETS_ENABLED).toBe(true);
    expect(env.GOOGLE_CALENDAR_ENABLED).toBe(false);
  });
  it("accepts Google's standard callback fields with Nest's strict validation", async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const input = {
      code: "code",
      state: "state",
      scope: "openid",
      authuser: "0",
      prompt: "consent",
    };
    await expect(
      pipe.transform(input, {
        type: "query",
        metatype: GoogleCallbackQueryDto,
      }),
    ).resolves.toMatchObject(input);
    await expect(
      pipe.transform(
        { ...input, userId: "other" },
        { type: "query", metatype: GoogleCallbackQueryDto },
      ),
    ).rejects.toThrow();
  });
  it("builds official SDK consent URLs with offline access, PKCE and incremental grants", () => {
    const config = {
      clientId: "id",
      clientSecret: "secret",
      redirectUri: () => "http://localhost/callback",
    } as unknown as GoogleConfig;
    const url = new URL(
      new GoogleOAuthClient(config).authorizationUrl({
        integration: "sheets",
        state: "state",
        codeChallenge: "challenge",
        scopes: ["openid", GOOGLE_SCOPES.sheets],
        subject: "google-user",
      }),
    );
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("login_hint")).toBe("google-user");
    expect(url.searchParams.get("scope")).toContain(GOOGLE_SCOPES.sheets);
  });
});
