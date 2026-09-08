import { describe, expect, test } from "bun:test";
import { generateNativeOpenAPI } from "../src/native-openapi.ts";

describe("native OpenAPI contract", () => {
  test("uses the Nest API prefix and preserves route-specific input mapping", async () => {
    const spec = await generateNativeOpenAPI();
    expect(spec.servers).toEqual([{ url: "/api" }]);
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    const transition =
      spec.paths?.["/focus/sessions/{sessionId}/transitions"]?.post;
    expect(transition?.operationId).toBe("focus.transition");
    expect(transition?.parameters).toContainEqual(
      expect.objectContaining({
        name: "sessionId",
        in: "path",
        required: true,
      }),
    );
    expect(transition?.requestBody).toEqual(
      expect.objectContaining({
        content: {
          "application/json": {
            schema: expect.objectContaining({
              required: expect.arrayContaining([
                "commandId",
                "expectedRevision",
                "action",
                "occurredAt",
              ]),
            }),
          },
        },
      }),
    );
    expect(spec.paths?.["/work-log/events"]?.get?.requestBody).toBeUndefined();
    expect(spec.paths?.["/work-log/events"]?.get?.parameters).toContainEqual(
      expect.objectContaining({ name: "limit", in: "query" }),
    );
  });

  test("exports typed session and Codex work-log responses", async () => {
    const spec = await generateNativeOpenAPI();
    const response = spec.paths?.["/focus/sessions"]?.get?.responses?.["200"];
    expect(response).toEqual(
      expect.objectContaining({
        content: {
          "application/json": {
            schema: expect.objectContaining({
              type: "array",
              items: expect.objectContaining({
                properties: expect.objectContaining({
                  id: expect.objectContaining({
                    type: "string",
                    format: "uuid",
                  }),
                  status: {
                    type: "string",
                    enum: ["running", "paused", "completed"],
                  },
                }),
              }),
            }),
          },
        },
      }),
    );
    const workLog = spec.paths?.["/work-log/events"]?.get?.responses?.["200"];
    expect(workLog).toEqual(
      expect.objectContaining({
        content: {
          "application/json": {
            schema: expect.objectContaining({
              required: ["entries", "nextCursor"],
            }),
          },
        },
      }),
    );
  });
});
