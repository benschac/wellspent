import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Module, UnauthorizedException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ORPCModule } from "@orpc/nest";
import { createDatabaseConnection, type Database } from "@repo/database";
import { sql } from "drizzle-orm";
import { SupabaseAuthGuard } from "../src/auth/supabase-auth.guard.js";
import { SupabaseAuthService } from "../src/auth/supabase-auth.service.js";
import {
  WorkLogController,
  WorkLogTokensController,
} from "../src/work-log/work-log.controller.js";
import { WorkLogRepository } from "../src/work-log/work-log.repository.js";

const localUrl = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const testUrl = process.env.WORK_LOG_TEST_DATABASE_URL;
if (testUrl !== undefined && testUrl !== localUrl)
  throw new Error("Use Timer's fixed local database for work log HTTP tests");
const suite = testUrl === undefined ? describe.skip : describe;
const rollback = new Error("rollback work log HTTP fixture");
const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260908122826_work_log.sql",
    import.meta.url,
  ),
  "utf8",
);
const cli = fileURLToPath(
  new URL("../../../integrations/work-log/cli.mjs", import.meta.url),
);

async function runCli(
  command: string,
  configPath: string,
  token: string,
  input: unknown,
) {
  const child = spawn(
    process.execPath,
    [cli, command, "--config", configPath],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TIMER_WORK_LOG_TOKEN: token },
    },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  try {
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    child.stdin.end(command === "mcp" ? input : JSON.stringify(input));
    const code = await exited;
    if (code !== 0)
      throw new Error(
        `CLI ${command} failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`,
      );
    return Buffer.concat(stdout)
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } finally {
    clearTimeout(timer);
  }
}

suite("work log mounted HTTP and real CLI/MCP", () => {
  it("logs and retrieves through subprocess transports without a focus session", async () => {
    const connection = createDatabaseConnection(localUrl);
    const temporary = await mkdtemp(join(tmpdir(), "timer-work-log-http-"));
    const configPath = join(temporary, "config.json");
    const previousGuardMetadata = Reflect.getMetadata(
      "design:paramtypes",
      SupabaseAuthGuard,
    );
    let app: NestExpressApplication | undefined;
    try {
      await connection.database.transaction(async (tx) => {
        const installed = await tx.execute(
          sql`select to_regclass('app.work_log_entries') as name`,
        );
        if (installed.rows[0]?.name === null) {
          for (const statement of migration.split("--> statement-breakpoint"))
            await tx.execute(sql.raw(statement));
        }
        const userId = crypto.randomUUID();
        await tx.execute(sql`insert into auth.users (id) values (${userId})`);
        const repository = new WorkLogRepository(tx as unknown as Database);
        // Only bootstrap account authentication is substituted. Scoped credentials,
        // mounted routes, serialization, subprocesses and Postgres are real.
        const auth = {
          authenticate: async (authorization: string | undefined) => {
            if (authorization !== "Bearer fixture-account")
              throw new UnauthorizedException();
            return { id: userId };
          },
        } as SupabaseAuthService;
        class WorkLogHttpFixtureModule {}
        // Bun does not emit TypeScript decorator constructor metadata; supply
        // the same metadata the production Nest compiler emits for this guard.
        Reflect.defineMetadata(
          "design:paramtypes",
          [SupabaseAuthService],
          SupabaseAuthGuard,
        );
        Module({
          imports: [ORPCModule.forRoot({})],
          controllers: [WorkLogController, WorkLogTokensController],
          providers: [
            { provide: WorkLogRepository, useValue: repository },
            { provide: SupabaseAuthService, useValue: auth },
            {
              provide: SupabaseAuthGuard,
              useValue: new SupabaseAuthGuard(auth),
            },
          ],
        })(WorkLogHttpFixtureModule);
        app = await NestFactory.create<NestExpressApplication>(
          WorkLogHttpFixtureModule,
          { logger: ["error"] },
        );
        app.setGlobalPrefix("api");
        await app.listen(0, "127.0.0.1");
        const origin = await app.getUrl();
        const credentialResponse = await fetch(
          `${origin}/api/work-log/tokens`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer fixture-account",
              "content-type": "application/json",
            },
            body: JSON.stringify({ label: "CLI smoke" }),
          },
        );
        expect(credentialResponse.status).toBe(200);
        const credential = (await credentialResponse.json()) as {
          id: string;
          token: string;
        };
        expect(typeof credential.token).toBe("string");
        const [configured] = await runCli(
          "configure",
          configPath,
          credential.token,
          { apiOrigin: origin, project: "timer-smoke" },
        );
        expect(configured.userId).toBe(userId);
        const id = crypto.randomUUID();
        const note = {
          id,
          summary: "Verified standalone logging",
          occurredAt: "2026-09-01T12:00:00.000Z",
        };
        const [logged] = await runCli(
          "log",
          configPath,
          credential.token,
          note,
        );
        expect(logged.status).toBe("acknowledged");
        const [retried] = await runCli(
          "log",
          configPath,
          credential.token,
          note,
        );
        expect(retried.status).toBe("acknowledged");
        const [history] = await runCli(
          "list",
          configPath,
          credential.token,
          {},
        );
        expect(history.entries).toHaveLength(1);
        expect(history.entries[0]).toMatchObject({
          id,
          source: "cli",
          summary: note.summary,
        });
        expect(history.entries[0].sessionId).toBeUndefined();
        const mcpId = crypto.randomUUID();
        const messages = `${[
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: { name: "smoke", version: "1" },
            },
          },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "log_work",
              arguments: {
                id: mcpId,
                summary: "Logged via real MCP process",
              },
            },
          },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "list_work", arguments: {} },
          },
        ]
          .map((message) => JSON.stringify(message))
          .join("\n")}\n`;
        const responses = await runCli(
          "mcp",
          configPath,
          credential.token,
          messages,
        );
        expect(responses).toHaveLength(3);
        expect(responses[0].result.serverInfo.name).toBe("timer-work-log");
        expect(JSON.parse(responses[1].result.content[0].text).status).toBe(
          "acknowledged",
        );
        const mcpHistory = JSON.parse(responses[2].result.content[0].text);
        expect(mcpHistory.entries).toHaveLength(2);
        expect(mcpHistory.entries[0]).toMatchObject({
          id: mcpId,
          source: "mcp",
        });
        const queuedId = crypto.randomUUID();
        const [queued] = await runCli("log", configPath, "twl_invalid", {
          id: queuedId,
          summary: "Saved while credential unavailable",
        });
        expect(queued.status).toBe("queued");
        // A new process reopens the durable queue and delivers with a recovered credential.
        await runCli("flush", configPath, credential.token, {});
        const [recovered] = await runCli(
          "list",
          configPath,
          credential.token,
          {},
        );
        expect(recovered.entries).toHaveLength(3);
        expect(recovered.entries[0].id).toBe(queuedId);
        const denied = await fetch(`${origin}/api/work-log/tokens`, {
          headers: { authorization: `Bearer ${credential.token}` },
        });
        expect(denied.status).toBe(401);
        await repository.revokeToken(userId, credential.id);
        const revoked = await fetch(`${origin}/api/work-log/identity`, {
          headers: { authorization: `Bearer ${credential.token}` },
        });
        expect(revoked.status).toBe(401);
        await app.close();
        app = undefined;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      if (previousGuardMetadata === undefined)
        Reflect.deleteMetadata("design:paramtypes", SupabaseAuthGuard);
      else
        Reflect.defineMetadata(
          "design:paramtypes",
          previousGuardMetadata,
          SupabaseAuthGuard,
        );
      await app?.close();
      await connection.close();
      await rm(temporary, { recursive: true, force: true });
    }
  }, 60000);
});
