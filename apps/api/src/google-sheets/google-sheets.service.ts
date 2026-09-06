import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { z } from "zod";
import { GoogleConfig } from "../google/google.config.js";
import { GoogleRepository } from "../google/google.repository.js";
import { GoogleOAuthService } from "../google/google-oauth.service.js";
import { GoogleSheetsClient, type SheetValue } from "./google-sheets.client.js";
import { GoogleSheetsRepository } from "./google-sheets.repository.js";

export const sheetsExportSchema = z
  .strictObject({ sessionIds: z.array(z.uuid()).min(1).max(500) })
  .refine(
    (input) => new Set(input.sessionIds).size === input.sessionIds.length,
    "Session IDs must be unique",
  );

@Injectable()
export class GoogleSheetsService {
  constructor(
    @Inject(GoogleConfig) private readonly config: GoogleConfig,
    @Inject(GoogleOAuthService) private readonly oauth: GoogleOAuthService,
    @Inject(GoogleRepository) private readonly google: GoogleRepository,
    @Inject(GoogleSheetsRepository)
    private readonly repository: GoogleSheetsRepository,
    @Inject(GoogleSheetsClient) private readonly client: GoogleSheetsClient,
  ) {}
  connect(userId: string) {
    return this.oauth.beginAuthorization(userId, "sheets");
  }
  async callback(input: { code?: string; error?: string; state?: string }) {
    const { userId } = await this.oauth.completeAuthorization("sheets", input);
    await this.google.enableSheets(userId);
    return { connected: true as const };
  }
  async status(userId: string) {
    this.config.assertEnabled("sheets");
    const enabled = await this.google.sheetsEnabled(userId);
    const auth = await this.oauth.status(userId, "sheets");
    return {
      connected: enabled && auth.authorized,
      reconnectRequired: enabled && !auth.authorized,
    };
  }
  async disconnect(userId: string) {
    // Feature disconnect never revokes a grant shared with Calendar.
    await this.google.disableSheets(userId);
  }
  async exportSessions(userId: string, input: unknown) {
    this.config.assertEnabled("sheets");
    const parsed = sheetsExportSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(
        "Provide between 1 and 500 unique session UUIDs",
      );
    if (!(await this.google.sheetsEnabled(userId)))
      throw new UnauthorizedException(
        "Connect Google Sheets to export sessions",
      );
    const sessions = await this.repository.findSessions(
      userId,
      parsed.data.sessionIds,
    );
    if (sessions.length !== parsed.data.sessionIds.length)
      throw new NotFoundException("One or more sessions were not found");
    if (
      sessions.some(
        (session) => session.status !== "completed" || !session.completedAt,
      )
    ) {
      throw new BadRequestException("Only completed sessions can be exported");
    }
    const rows: SheetValue[][] = [
      [
        "Session ID",
        "Intention",
        "Started at (UTC)",
        "Completed at (UTC)",
        "Duration (seconds)",
        "Recap",
      ],
      ...sessions.map((session) => [
        session.id,
        session.intention,
        session.createdAt.toISOString(),
        session.completedAt?.toISOString() ?? "",
        session.elapsedMs / 1000,
        session.recapText ?? "",
      ]),
    ];
    if (Buffer.byteLength(JSON.stringify(rows), "utf8") > 1_000_000) {
      throw new BadRequestException(
        "Export is too large; select fewer sessions",
      );
    }
    const accessToken = await this.oauth.getAccessToken(userId, "sheets");
    const spreadsheet = await this.client.createSpreadsheet(
      accessToken,
      `Focus Timer ${new Date().toISOString().slice(0, 10)}`,
      rows,
    );
    return { ...spreadsheet, exportedSessionCount: sessions.length };
  }
}
