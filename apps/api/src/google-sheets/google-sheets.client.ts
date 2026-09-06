import { sheets, type sheets_v4 } from "@googleapis/sheets";
import { BadGatewayException, Injectable } from "@nestjs/common";

export type SheetValue = string | number | boolean;

// Provider adapter is reusable; it knows nothing about Timer sessions or users.
@Injectable()
export class GoogleSheetsClient {
  async createSpreadsheet(
    accessToken: string,
    title: string,
    rows: SheetValue[][],
  ) {
    const requestBody: sheets_v4.Schema$Spreadsheet = {
      properties: { title },
      sheets: [
        {
          properties: {
            title: "Sessions",
            gridProperties: {
              frozenRowCount: 1,
              rowCount: rows.length,
              columnCount: rows[0]?.length ?? 1,
            },
          },
          data: [
            {
              rowData: rows.map((row) => ({
                values: row.map((value) => ({
                  userEnteredValue:
                    typeof value === "number"
                      ? { numberValue: value }
                      : typeof value === "boolean"
                        ? { boolValue: value }
                        : { stringValue: value },
                })),
              })),
            },
          ],
        },
      ],
    };
    const client = sheets({ version: "v4" });
    try {
      // Creation is not idempotent. Disable automatic retries to avoid duplicate
      // spreadsheets after an ambiguous timeout. Values are literal, never formulas.
      const response = await client.spreadsheets.create(
        { requestBody, fields: "spreadsheetId,spreadsheetUrl" },
        {
          headers: { authorization: `Bearer ${accessToken}` },
          timeout: 30_000,
          retry: false,
        },
      );
      const spreadsheetId = response.data.spreadsheetId;
      if (!spreadsheetId) throw new Error("Missing spreadsheet ID");
      return {
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
      };
    } catch {
      throw new BadGatewayException(
        "Google Sheets export failed. Check your Drive before retrying if the request timed out.",
      );
    }
  }
}
