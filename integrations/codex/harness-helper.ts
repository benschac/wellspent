#!/usr/bin/env node
// Explicit local notes only. No hosted client, hook installation or transcript reads.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa, type Options } from "execa";
import {
  base64,
  bodyDigest,
  canonicalTime,
  exactKeys,
  MAX_WIRE,
  sign,
  uuid,
  verify,
} from "./local-contract.mjs";
import {
  lock,
  optional,
  privateDirectory,
  publish,
  read,
  remove,
  sync,
} from "./local-helper.mjs";

export const DEFAULT_ROOT = join(homedir(), ".config/wellspent/codex-harness");
const mcpPath = fileURLToPath(new URL("./harness-mcp.mjs", import.meta.url));
// biome-ignore lint/suspicious/noExplicitAny: legacy JSON persistence helpers are migrated separately.
type JsonRecord = Record<string, any>;
type Connection = {
  version: 1;
  connectionID: string;
  key: string;
  endpoint: string;
  localScopeID: string;
  revoked: boolean;
};
type NoteInput = { id: string; text: string };
type TerminalResult = {
  status: string;
  reason: string;
  nativeReceivedAt: string | null;
};
export type Execute = (
  file: string,
  args: readonly string[],
  options: Options,
) => Promise<{ stdout: string }>;

const run: Execute = async (file, args, options) => {
  const { stdout } = await execa(file, args, options);
  if (typeof stdout !== "string") throw new Error("invalid_command_output");
  return { stdout };
};
const validID = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
const validScope = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= 200 &&
  ![...value].some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const pathFor = (root: string, directory: string, id: string) => {
  if (!validID(id)) throw new Error("invalid_identity");
  return join(root, directory, `${id.toLowerCase()}.json`);
};
export async function openHarnessRoot(directory = DEFAULT_ROOT) {
  const root = resolve(directory);
  const checkout = await realpath(resolve(dirname(mcpPath), "../.."));
  if (root === checkout || root.startsWith(`${checkout}/`))
    throw new Error("invalid_root");
  await privateDirectory(root);
  if ((await realpath(root)) !== root) throw new Error("invalid_root");
  for (const directory of [
    "requests",
    "pending",
    "receipts",
    "connections",
    "nonces",
  ])
    await privateDirectory(join(root, directory));
  return root;
}
export async function connection(root: string): Promise<Connection> {
  const value = await read(join(root, "connection.json"));
  if (
    !exactKeys(value, [
      "version",
      "connectionID",
      "key",
      "endpoint",
      "localScopeID",
      "revoked",
    ]) ||
    value.version !== 1 ||
    !validID(value.connectionID) ||
    !validScope(value.localScopeID) ||
    typeof value.revoked !== "boolean" ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(value.endpoint) ||
    Number(new URL(value.endpoint).port) > 65535 ||
    base64(value.key, 32).length !== 32
  )
    throw new Error("invalid_connection");
  return value as Connection;
}
async function freeEndpoint(): Promise<string> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  if (!address || typeof address === "string")
    throw new Error("invalid_endpoint");
  return `http://127.0.0.1:${address.port}`;
}
export async function connect(
  root: string,
  { scope, codex, node }: { scope: string; codex: string; node: string },
  execute: Execute = run,
) {
  if (!validScope(scope) || !isAbsolute(codex ?? "") || !isAbsolute(node ?? ""))
    throw new Error("invalid_installation");
  const args = [mcpPath, "--root", root];
  const options: Options = {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    // npm-installed Codex may use /usr/bin/env node. Native launch environments
    // often omit Node's directory even though both executables are absolute.
    env: {
      ...process.env,
      PATH: [dirname(node), process.env.PATH ?? ""].join(delimiter),
    },
  };
  return lock(root, async () => {
    const previous = await optional(join(root, "connection.json"));
    if (previous) {
      await connection(root);
      if (previous.localScopeID !== scope) throw new Error("scope_conflict");
    }
    const listed: JsonRecord[] = JSON.parse(
      (await execute(codex, ["mcp", "list", "--json"], options)).stdout,
    );
    if (!Array.isArray(listed)) throw new Error("invalid_codex_config");
    const existing = listed.find((item) => item.name === "wellspent-local");
    const transport = existing?.transport;
    const registration = await optional(join(root, "registration.json"));
    const matches = (command: unknown, arguments_: unknown) =>
      transport?.type === "stdio" &&
      transport.command === command &&
      JSON.stringify(transport.args) === JSON.stringify(arguments_);
    const owned =
      previous &&
      registration?.connectionID === previous.connectionID &&
      (matches(registration.command, registration.args) ||
        matches(registration.previousCommand, registration.previousArgs) ||
        matches(node, args));
    if (
      existing &&
      (!owned ||
        (transport.env && Object.keys(transport.env).length > 0) ||
        transport.env_vars?.length > 0 ||
        transport.cwd)
    )
      throw new Error("mcp_name_conflict");
    const saved =
      previous && !previous.revoked
        ? previous
        : {
            version: 1,
            connectionID: randomUUID(),
            key: randomBytes(32).toString("base64"),
            endpoint: previous?.endpoint ?? (await freeEndpoint()),
            localScopeID: scope,
            revoked: false,
          };
    if (previous?.revoked)
      await publish(
        pathFor(root, "connections", previous.connectionID),
        previous,
      );
    // Persist the private identity before registration; repair preserves it.
    await publish(
      join(root, "connection.json"),
      saved,
      previous?.revoked === true,
    );
    // Record exact ownership before invoking Codex, including failed installation repair.
    await publish(
      join(root, "registration.json"),
      {
        connectionID: saved.connectionID,
        command: node,
        args,
        installed: false,
        previousCommand: transport?.command ?? null,
        previousArgs: transport?.args ?? null,
      },
      true,
    );
    // An unchanged registration keeps the existing MCP session usable. Only
    // changed setup or a new authorization identity needs fresh discovery.
    if (
      previous?.connectionID !== saved.connectionID ||
      !existing ||
      existing.enabled === false ||
      !matches(node, args)
    )
      await remove(join(root, "discovered.json"));
    await sync(root);
    if (!existing || existing.enabled === false || !matches(node, args))
      await execute(
        codex,
        ["mcp", "add", "wellspent-local", "--", node, ...args],
        options,
      );
    await publish(
      join(root, "registration.json"),
      {
        connectionID: saved.connectionID,
        command: node,
        args,
        installed: true,
      },
      true,
    );
    return saved;
  });
}
const terminal = (
  status: string,
  reason: string,
  nativeReceivedAt: string | null = null,
): TerminalResult => ({
  status,
  reason,
  nativeReceivedAt,
});
async function finish(root: string, id: string, value: JsonRecord) {
  await publish(pathFor(root, "receipts", id), value);
  await remove(pathFor(root, "pending", id));
  await sync(join(root, "pending"));
  return read(pathFor(root, "receipts", id));
}
export async function revoke(root: string) {
  return lock(root, async () => {
    const current = await connection(root);
    await publish(
      join(root, "connection.json"),
      { ...current, revoked: true },
      true,
    );
    for (const name of await readdir(join(root, "pending"))) {
      if (/^[a-f0-9-]{36}\.json$/.test(name))
        await finish(
          root,
          name.slice(0, -5),
          terminal("rejected", "connection_revoked"),
        );
    }
    return { revoked: true };
  });
}
export async function discover(root: string, expectedConnectionID?: string) {
  return lock(root, async () => {
    const current = await connection(root);
    if (current.revoked) throw new Error("connection_revoked");
    if (expectedConnectionID && expectedConnectionID !== current.connectionID)
      throw new Error("connection_changed");
    await publish(join(root, "discovered.json"), {
      connectionID: current.connectionID,
    });
  });
}
export function validateInput(input: JsonRecord): NoteInput {
  if (
    !exactKeys(input, ["id", "text"]) ||
    !validID(input.id) ||
    typeof input.text !== "string" ||
    input.text.trim().length === 0 ||
    Buffer.byteLength(input.text) > 4096 ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      input.text,
    )
  )
    throw new Error("invalid_note");
  return { id: input.id.toLowerCase(), text: input.text };
}
async function existingRequest(root: string, input: NoteInput) {
  const saved = await optional(pathFor(root, "requests", input.id));
  if (saved && saved.textDigest !== inputIdentity(input).textDigest)
    throw new Error("identity_conflict");
  return saved;
}
function inputIdentity(input: NoteInput) {
  // The signed packet already contains accepted text. A digest avoids keeping a
  // second escaped copy and retains only content-free identity for rejected work.
  return {
    id: input.id,
    textDigest: createHash("sha256").update(input.text, "utf8").digest("hex"),
  };
}
export function createHarness(root: string, clock = () => new Date()) {
  let heartbeat: null | {
    connectionID: string;
    epoch: string;
    active: null | {
      recordingID: string;
      intervalID: string;
      localScopeID: string;
    };
    time: number;
  } = null;
  async function authenticated(
    packet: JsonRecord,
    domain: string,
    keys: string[],
  ) {
    const current = await connection(root);
    const value = verify(packet, base64(current.key, 32), domain);
    const now = clock().getTime();
    if (
      !exactKeys(value, keys) ||
      value.version !== 1 ||
      value.connectionID !== current.connectionID ||
      !validID(value.nonce) ||
      !canonicalTime(value.issuedAt) ||
      Math.abs(now - Date.parse(value.issuedAt)) > 15000
    )
      throw new Error("invalid_request");
    let count = 0;
    for (const name of await readdir(join(root, "nonces"))) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const noncePath = join(root, "nonces", name);
      if ((await read(noncePath)).expires < now) await remove(noncePath);
      else count++;
    }
    if ((await optional(pathFor(root, "nonces", value.nonce))) || count >= 4096)
      throw new Error("replayed_request");
    await publish(pathFor(root, "nonces", value.nonce), {
      expires: now + 30000,
    });
    return { current, value };
  }
  return async function dispatch(route: string, packet: JsonRecord) {
    return lock(root, async () => {
      if (route === "/v1/harness/poll") {
        const { current, value } = await authenticated(packet, "harness-poll", [
          "version",
          "connectionID",
          "nonce",
          "issuedAt",
          "epoch",
          "active",
        ]);
        if (current.revoked) throw new Error("connection_revoked");
        const active = value.active;
        if (
          !validID(value.epoch) ||
          (active !== null &&
            (!exactKeys(active, [
              "recordingID",
              "intervalID",
              "localScopeID",
            ]) ||
              !validID(active.recordingID) ||
              !validID(active.intervalID) ||
              active.localScopeID !== current.localScopeID))
        )
          throw new Error("invalid_active_interval");
        heartbeat = {
          connectionID: current.connectionID,
          epoch: value.epoch,
          active,
          time: clock().getTime(),
        };
        let request = null;
        for (const name of await readdir(join(root, "pending"))) {
          if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
          const id = name.slice(0, -5);
          if (await optional(pathFor(root, "receipts", id))) {
            await remove(pathFor(root, "pending", id));
            continue;
          }
          request = await read(pathFor(root, "pending", id));
          const saved = await read(pathFor(root, "requests", id));
          if (saved.connectionID !== current.connectionID) {
            await finish(root, id, terminal("rejected", "connection_revoked"));
            request = null;
            continue;
          }
          break;
        }
        const discovered =
          (await optional(join(root, "discovered.json")))?.connectionID ===
          current.connectionID;
        return sign(
          { nonce: value.nonce, request, discovered },
          base64(current.key, 32),
          "harness-response",
          // The nested signed note is base64-encoded; its own 8 KiB limit stays
          // unchanged. Outer responses still obey the global 16 KiB wire bound.
          12288,
        );
      }
      if (route === "/v1/harness/result") {
        const { current, value } = await authenticated(
          packet,
          "harness-result",
          [
            "version",
            "connectionID",
            "eventID",
            "bodyDigest",
            "status",
            "reason",
            "nativeReceivedAt",
            "nonce",
            "issuedAt",
          ],
        );
        if (current.revoked) throw new Error("connection_revoked");
        if (
          !validID(value.eventID) ||
          !["acknowledged", "rejected"].includes(value.status) ||
          typeof value.reason !== "string" ||
          value.reason.length > 200 ||
          (value.nativeReceivedAt !== null &&
            !canonicalTime(value.nativeReceivedAt)) ||
          (value.status === "acknowledged" && value.nativeReceivedAt === null)
        )
          throw new Error("invalid_result");
        const saved = await read(pathFor(root, "requests", value.eventID));
        if (!saved.packet || bodyDigest(saved.packet) !== value.bodyDigest)
          throw new Error("identity_conflict");
        const result = await finish(root, value.eventID, value);
        return sign(
          { nonce: value.nonce, status: result.status },
          base64(current.key, 32),
          "harness-response",
        );
      }
      if (route === "/v1/harness/log") {
        const { current, value } = await authenticated(packet, "harness-call", [
          "version",
          "connectionID",
          "nonce",
          "issuedAt",
          "id",
          "text",
          "reportedAt",
        ]);
        const input = validateInput({ id: value.id, text: value.text });
        if (
          !canonicalTime(value.reportedAt) ||
          Date.parse(value.reportedAt) > clock().getTime() + 1000 ||
          clock().getTime() - Date.parse(value.reportedAt) > 15000
        )
          throw new Error("invalid_note_time");
        const prior = await existingRequest(root, input);
        if (prior && prior.connectionID !== current.connectionID)
          throw new Error("connection_changed");
        if (prior && current.revoked) throw new Error("connection_revoked");
        if (!prior) {
          if ((await readdir(join(root, "requests"))).length >= 10000)
            throw new Error("storage_full");
          const currentHeartbeat = heartbeat;
          const elapsed = currentHeartbeat
            ? clock().getTime() - currentHeartbeat.time
            : -1;
          const valid =
            !current.revoked &&
            currentHeartbeat?.connectionID === current.connectionID &&
            currentHeartbeat.active !== null &&
            elapsed >= 0 &&
            elapsed <= 3000;
          const note =
            valid && currentHeartbeat?.active
              ? sign(
                  {
                    version: 1,
                    connectionID: current.connectionID,
                    eventID: input.id,
                    text: input.text,
                    reportedAt: value.reportedAt,
                    epoch: currentHeartbeat.epoch,
                    localScopeID: currentHeartbeat.active.localScopeID,
                    recordingID: currentHeartbeat.active.recordingID,
                    intervalID: currentHeartbeat.active.intervalID,
                  },
                  base64(current.key, 32),
                  "harness-note",
                )
              : null;
          await publish(pathFor(root, "requests", input.id), {
            ...inputIdentity(input),
            connectionID: current.connectionID,
            reportedAt: value.reportedAt,
            packet: note,
          });
          if (note) await publish(pathFor(root, "pending", input.id), note);
          else
            await finish(
              root,
              input.id,
              terminal(
                "rejected",
                current.revoked ? "connection_revoked" : "no_active_recording",
              ),
            );
        } else if (
          prior.packet &&
          !(await optional(pathFor(root, "receipts", input.id)))
        ) {
          // Recover a crash after immutable identity persistence and before queue publication.
          await publish(pathFor(root, "pending", input.id), prior.packet);
        } else if (!prior.packet)
          await finish(
            root,
            input.id,
            terminal("rejected", "no_active_recording"),
          );
        return sign(
          { nonce: value.nonce, accepted: true },
          base64(current.key, 32),
          "harness-call-response",
        );
      }
      throw new Error("unknown_route");
    });
  };
}
export async function serve(root: string) {
  const current = await connection(root);
  if (current.revoked) throw new Error("connection_revoked");
  const dispatch = createHarness(root);
  const server = createServer(
    { maxHeaderSize: 4096 },
    async (request, response) => {
      try {
        const route = request.url;
        if (
          request.socket.remoteAddress !== "127.0.0.1" ||
          request.method !== "POST" ||
          ![
            "/v1/harness/poll",
            "/v1/harness/result",
            "/v1/harness/log",
          ].includes(route ?? "") ||
          request.headers.origin ||
          request.headers.host !== new URL(current.endpoint).host ||
          request.headers["content-type"] !== "application/json" ||
          request.headers["content-encoding"] ||
          (request.headers["content-length"] !== undefined &&
            (!/^\d+$/.test(request.headers["content-length"]) ||
              Number(request.headers["content-length"]) > MAX_WIRE))
        )
          throw new Error("invalid_request");
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > MAX_WIRE) throw new Error("packet_too_large");
          chunks.push(chunk);
        }
        const result = await dispatch(
          route ?? "",
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          ),
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end('{"error":"local_harness_unavailable"}');
      }
    },
  );
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.timeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 16;
  server.maxRequestsPerSocket = 100;
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(Number(new URL(current.endpoint).port), "127.0.0.1", done);
  });
  return server;
}
export async function logWork(
  root: string,
  raw: NoteInput,
  {
    waitMs = 10000,
    expectedConnectionID,
  }: { waitMs?: number; expectedConnectionID?: string } = {},
) {
  const input = validateInput(raw);
  const reportedAt = new Date().toISOString();
  const current = await connection(root);
  if (expectedConnectionID && expectedConnectionID !== current.connectionID)
    return terminal("rejected", "connection_changed");
  const saved = await lock(root, async () => {
    const prior = await existingRequest(root, input);
    if (current.revoked && !prior) {
      if ((await readdir(join(root, "requests"))).length >= 10000)
        throw new Error("storage_full");
      await publish(pathFor(root, "requests", input.id), {
        ...inputIdentity(input),
        connectionID: current.connectionID,
        reportedAt,
        packet: null,
      });
      await finish(root, input.id, terminal("rejected", "connection_revoked"));
    }
    return prior;
  });
  if (current.revoked || (saved && saved.connectionID !== current.connectionID))
    return terminal(
      "rejected",
      current.revoked ? "connection_revoked" : "connection_changed",
    );
  let result = await optional(pathFor(root, "receipts", input.id));
  if (result) return result;
  try {
    const nonce = randomUUID();
    const packet = sign(
      {
        version: 1,
        connectionID: current.connectionID,
        nonce,
        issuedAt: new Date().toISOString(),
        ...input,
        reportedAt,
      },
      base64(current.key, 32),
      "harness-call",
    );
    const response = await fetch(`${current.endpoint}/v1/harness/log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(packet),
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("helper_unavailable");
    if (!response.body) throw new Error("invalid_response");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_WIRE) throw new Error("invalid_response");
      chunks.push(chunk);
    }
    const reply = verify(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ),
      base64(current.key, 32),
      "harness-call-response",
    );
    if (reply.nonce !== nonce || reply.accepted !== true)
      throw new Error("invalid_response");
  } catch {
    // A lost response may follow durable admission. Never replace that identity.
    await lock(root, async () => {
      const latest = await connection(root);
      if (latest.connectionID !== current.connectionID || latest.revoked)
        return;
      const existing = await existingRequest(root, input);
      if (!existing) {
        if ((await readdir(join(root, "requests"))).length >= 10000)
          throw new Error("storage_full");
        await publish(pathFor(root, "requests", input.id), {
          ...inputIdentity(input),
          connectionID: current.connectionID,
          reportedAt,
          packet: null,
        });
        await finish(
          root,
          input.id,
          terminal(
            "rejected",
            current.revoked ? "connection_revoked" : "helper_unavailable",
          ),
        );
      }
    });
  }
  const deadline = performance.now() + waitMs;
  do {
    const latest = await connection(root);
    if (latest.revoked || latest.connectionID !== current.connectionID)
      return terminal(
        "rejected",
        latest.revoked ? "connection_revoked" : "connection_changed",
      );
    result = await optional(pathFor(root, "receipts", input.id));
    if (result) return result;
    await new Promise((done) => setTimeout(done, 50));
  } while (performance.now() < deadline);
  return terminal("unconfirmed", "native_commit_unconfirmed");
}
export async function main() {
  const args = process.argv.slice(2);
  let directory = DEFAULT_ROOT;
  if (args[0] === "--root") {
    args.shift();
    const requestedDirectory = args.shift();
    if (!requestedDirectory) throw new Error("invalid_arguments");
    directory = requestedDirectory;
  }
  const command = args.shift();
  const root = await openHarnessRoot(directory);
  let result: unknown;
  if (command === "connect") {
    if (
      args.length !== 6 ||
      args[0] !== "--scope" ||
      args[2] !== "--codex" ||
      args[4] !== "--node"
    )
      throw new Error("invalid_arguments");
    const [scope, codex, node] = [args[1], args[3], args[5]];
    if (!scope || !codex || !node) throw new Error("invalid_arguments");
    result = await connect(root, { scope, codex, node });
  } else if (args.length !== 0) throw new Error("invalid_arguments");
  else if (command === "connection") {
    const current = await connection(root);
    result = current;
    const registration = await optional(join(root, "registration.json"));
    if (
      registration?.connectionID !== current.connectionID ||
      registration.installed !== true
    )
      throw new Error("registration_incomplete");
  } else if (command === "revoke") result = await revoke(root);
  else if (command === "serve") {
    const server = await serve(root);
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => {
        server.close();
        server.closeAllConnections();
      });
    return;
  } else throw new Error("invalid_command");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    process.stderr.write(
      "Local AI Harness operation failed; existing connection and evidence were preserved.\n",
    );
    process.exitCode = 1;
  });
