#!/usr/bin/env bun
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, defaultConfigPath, openWorkLog } from "./client.mjs";
import { serveMcp } from "./mcp.mjs";

async function readInput() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Input exceeds 1 MiB.");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8").trim();
  return body ? JSON.parse(body) : {};
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || ["help", "--help"].includes(command)) {
    process.stdout.write(
      "Timer work log (Bun)\nCommands: configure, log, list, flush, status, mcp\nUse --config /private/path/config.json for a separate destination.\nconfigure/log/list read JSON from stdin; list accepts empty input.\nCredential: TIMER_WORK_LOG_TOKEN (never a command-line argument).\n",
    );
    return;
  }
  if (rest.length && (rest.length !== 2 || rest[0] !== "--config" || !rest[1]))
    throw new Error("Expected --config followed by a path.");
  const configPath = rest[1] ?? defaultConfigPath;
  if (command === "mcp") {
    await serveMcp(process.stdin, process.stdout, () =>
      openWorkLog(configPath),
    );
    return;
  }
  let result;
  if (command === "configure") {
    const config = await connect(
      configPath,
      await readInput(),
      process.env.TIMER_WORK_LOG_TOKEN,
    );
    result = {
      configured: true,
      userId: config.userId,
      apiOrigin: config.apiOrigin,
      tokenEnvironmentVariable: "TIMER_WORK_LOG_TOKEN",
    };
  } else {
    const client = await openWorkLog(configPath);
    if (command === "log") result = await client.log(await readInput());
    else if (command === "list")
      result = await client.list(process.stdin.isTTY ? {} : await readInput());
    else if (command === "flush") result = await client.flush();
    else if (command === "status") result = await client.status();
    else throw new Error("Unknown command. Run with --help.");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "rejected") process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write(
      "Work-log operation failed. Check JSON input, private configuration, TIMER_WORK_LOG_TOKEN, and API connectivity. Run --help for usage.\n",
    );
    process.exitCode = 1;
  });
}
