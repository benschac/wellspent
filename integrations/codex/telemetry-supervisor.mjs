// The existing development host owns this mailbox and the original local helper.
// Only a fresh native request can authorize one bounded source read.
import { join } from "node:path";
import { discoverLoadedSessions } from "./app-server-discovery.mjs";
import {
  AUTOMATIC_LIMITS,
  createAutomaticCapture,
  retireDrainedAutomaticBindings,
  stopAutomaticReaders,
} from "./automatic-telemetry-reader.mjs";
import {
  canonicalTime,
  exactKeys,
  uuid,
  validateBundle,
} from "./local-contract.mjs";
import {
  openLocalRoot,
  optional,
  publish,
  serve,
  setup,
} from "./local-helper.mjs";
import {
  READER_LIMITS,
  readSelectedTelemetry,
  replaceTelemetrySource,
  selectedReaderStatus,
  stopSelectedTelemetry,
} from "./selected-telemetry-reader.mjs";

const codes = new Set([
  "api_unavailable",
  "api_timeout",
  "api_protocol",
  "api_session_limit",
  "api_response_limit",
  "api_source_missing",
  "invalid_source",
  "invalid_source_header",
  "header_limit",
  "discovery_limit",
  "source_limit",
  "directory_replaced",
  "overall_byte_limit",
  "reader_storage_limit",
  "window_ended",
  "invalid_request",
  "authorization_required",
  "binding_mismatch",
  "invalid_byte_limit",
  "unsupported_source_version",
  "invalid_session",
  "invalid_eof",
  "invalid_window",
  "eof_changed",
  "eof_partial_line",
  "pause_or_recover_first",
  "fresh_binding_required",
  "source_path",
  "source_permission",
  "source_replaced",
  "source_unavailable",
  "binding_conflict",
  "sender_mismatch",
  "endpoint_mismatch",
  "pairing_unavailable",
  "storage_busy",
  "invalid_binding",
  "reader_unavailable",
  "invalid_pairing",
  "invalid_endpoint",
  "queue_full",
  "identityConflict",
  "observation_limit",
]);
function safeError(error) {
  if (["ENOENT", "ELOOP"].includes(error?.code)) return "source_unavailable";
  if (["EACCES", "EPERM"].includes(error?.code)) return "source_permission";
  return codes.has(error?.message) ? error.message : "reader_unavailable";
}
const fail = (code) => {
  throw new Error(code);
};

export async function createTelemetrySupervisor(
  harnessRoot,
  runnerID,
  clock = () => new Date(),
  resolveCodex = async () => "codex",
) {
  const root = join(harnessRoot, "telemetry");
  let startupError = null;
  try {
    await openLocalRoot(root);
  } catch (error) {
    startupError = safeError(error);
  }
  let authorization = null;
  let automatic = null;
  let directoryLease = null;
  let server = null;
  let stopped = false;
  const seen = new Set();
  // A saved selection is diagnostic state, never continuing authorization.
  try {
    await stopSelectedTelemetry(root, "helper_restarted", clock());
  } catch (error) {
    startupError = safeError(error);
  }
  try {
    if (await stopAutomaticReaders(root, "helper_restarted", clock()))
      startupError ??= "reader_unavailable";
    await retireDrainedAutomaticBindings(root);
  } catch (error) {
    startupError ??= safeError(error);
  }
  const startServer = async () => {
    if (server) return;
    try {
      server = await serve(root);
    } catch (error) {
      if (error.message !== "pairing_unavailable") throw error;
    }
  };
  // Old queue delivery can resume independently of private-source reads.
  try {
    await startServer();
  } catch (error) {
    startupError = safeError(error);
  }

  async function permitted(id, bindingID) {
    try {
      const value = await optional(join(harnessRoot, "telemetry-permit.json"));
      return (
        exactKeys(value, ["authorizationID", "bindingID", "enabled"]) &&
        value.authorizationID === id &&
        value.bindingID === bindingID &&
        value.enabled === true
      );
    } catch {
      return false;
    }
  }
  async function directoryPermitted(id) {
    try {
      const value = await optional(join(harnessRoot, "telemetry-permit.json"));
      const instant = clock().getTime();
      if (directoryLease?.id === id && directoryLease.expiresAt <= instant)
        return false;
      const remaining = Date.parse(value?.expiresAt) - instant;
      const allowed =
        exactKeys(value, [
          "authorizationID",
          "runnerID",
          "enabled",
          "expiresAt",
        ]) &&
        value.authorizationID === id &&
        value.runnerID === runnerID &&
        value.enabled === true &&
        canonicalTime(value.expiresAt) &&
        remaining > 0 &&
        remaining <= AUTOMATIC_LIMITS.leaseMS;
      if (allowed)
        directoryLease = { id, expiresAt: Date.parse(value.expiresAt) };
      return allowed;
    } catch {
      return false;
    }
  }
  async function status() {
    if (automatic) {
      const value = await automatic.snapshot();
      if (value.enabled && Date.parse(value.endsAt) <= clock().getTime())
        return automatic.stop("window_ended");
      if (value.enabled && !(await directoryPermitted(value.authorizationID)))
        return automatic.stop("expired");
      return value;
    }
    let reader = await selectedReaderStatus(root);
    if (reader.enabled && Date.parse(reader.endsAt) <= clock().getTime()) {
      authorization = null;
      reader = await stopSelectedTelemetry(root, "window_ended", clock());
    }
    return reader;
  }
  async function processRequest() {
    if (stopped) return;
    const request = await optional(join(harnessRoot, "telemetry-request.json"));
    if (
      !request ||
      typeof request.id !== "string" ||
      !uuid.test(request.id) ||
      request.runnerID !== runnerID ||
      seen.has(request.id)
    )
      return;
    if (seen.size >= 10000) seen.delete(seen.values().next().value);
    seen.add(request.id);
    let error = null;
    let reader = null;
    try {
      const age = clock().getTime() - Date.parse(request.requestedAt);
      if (
        !exactKeys(request, [
          "version",
          "id",
          "runnerID",
          "action",
          "payload",
          "requestedAt",
        ]) ||
        request.version !== 1 ||
        !canonicalTime(request.requestedAt) ||
        age < 0 ||
        age > 15000 ||
        ![
          "activate",
          "read",
          "stop",
          "status",
          "directoryActivate",
          "directoryDiscover",
          "directoryEnroll",
          "directoryRead",
          "directoryStop",
        ].includes(request.action)
      )
        fail("invalid_request");
      if (request.action.startsWith("directory")) {
        const payload = request.payload;
        if (request.action === "directoryActivate") {
          if (
            !(
              exactKeys(payload, ["directoryPath"]) ||
              (exactKeys(payload, ["directoryPath", "discoveryMode"]) &&
                payload.discoveryMode === "appServer")
            ) ||
            typeof payload.directoryPath !== "string"
          )
            fail("invalid_request");
          if (!(await directoryPermitted(request.id)))
            fail("authorization_required");
          if (automatic) await automatic.stop("stopped");
          authorization = null;
          await stopSelectedTelemetry(root, "stopped", clock());
          automatic = await createAutomaticCapture({
            root,
            directoryPath: payload.directoryPath,
            authorizationID: request.id,
            permitted: () => directoryPermitted(request.id),
            clock,
            discoverSessions:
              payload.discoveryMode === "appServer"
                ? async ({ maxBytes }) =>
                    discoverLoadedSessions({
                      maxBytes,
                      codex: await resolveCodex(),
                      permitted: () => directoryPermitted(request.id),
                    })
                : null,
          });
          reader = await automatic.discover();
          startupError = null;
        } else {
          const keys =
            request.action === "directoryEnroll"
              ? ["authorizationID", "sourceID", "bundle"]
              : ["authorizationID"];
          if (!exactKeys(payload, keys)) fail("invalid_request");
          if (
            !automatic ||
            payload.authorizationID !==
              (await automatic.snapshot()).authorizationID
          )
            fail("authorization_required");
          if (request.action === "directoryStop") {
            reader = await automatic.stop("stopped");
            await retireDrainedAutomaticBindings(root);
          } else if (request.action === "directoryEnroll") {
            if (!(await directoryPermitted(payload.authorizationID)))
              fail("authorization_required");
            const bundle = validateBundle(payload.bundle);
            await retireDrainedAutomaticBindings(root);
            await setup(root, bundle);
            await startServer();
            reader = await automatic.enroll(payload.sourceID, bundle);
          } else
            reader = await (request.action === "directoryRead"
              ? automatic.read()
              : automatic.discover());
        }
      } else if (request.action === "activate") {
        if (automatic) {
          await automatic.stop("stopped");
          automatic = null;
        }
        const payload = request.payload;
        if (
          !exactKeys(payload, ["bundle", "selection"]) ||
          !exactKeys(payload.selection, [
            "bindingID",
            "filePath",
            "sessionID",
            "sourceVersion",
            "eofOffset",
            "endsAt",
            "maxBytes",
          ])
        )
          fail("invalid_request");
        const bundle = validateBundle(payload.bundle);
        if (payload.selection.bindingID !== bundle.binding.bindingID)
          fail("binding_mismatch");
        if (
          !Number.isSafeInteger(payload.selection.maxBytes) ||
          payload.selection.maxBytes < 1 ||
          payload.selection.maxBytes > READER_LIMITS.totalBytes
        )
          fail("invalid_byte_limit");
        // Always retire expiry, even if the previous native client disappeared
        // while this supervisor kept its process-local authorization.
        let previous = await status();
        if (!(await permitted(request.id, bundle.binding.bindingID)))
          fail("authorization_required");
        if (
          authorization &&
          !(await permitted(authorization.id, authorization.bindingID))
        ) {
          // A new explicit native permit replaces the old client authorization.
          // Recover only metadata already journaled; never reopen the old source.
          authorization = null;
          previous = await stopSelectedTelemetry(root, "stopped", clock());
        }
        if (authorization || previous.enabled) fail("pause_or_recover_first");
        await openLocalRoot(root);
        await setup(root, bundle);
        await startServer();
        reader = await replaceTelemetrySource(
          root,
          payload.selection,
          clock(),
          () => permitted(request.id, bundle.binding.bindingID),
        );
        authorization = { id: request.id, bindingID: bundle.binding.bindingID };
        startupError = null;
      } else if (request.action === "status") {
        if (request.payload !== null) fail("invalid_request");
        if (startupError) fail(startupError);
        reader = await status();
      } else {
        const payload = request.payload;
        if (!exactKeys(payload, ["authorizationID", "bindingID"]))
          fail("invalid_request");
        if (!authorization || payload.authorizationID !== authorization.id)
          fail("authorization_required");
        if (payload.bindingID !== authorization.bindingID)
          fail("binding_mismatch");
        if (request.action === "stop") {
          authorization = null;
          reader = await stopSelectedTelemetry(root, "stopped", clock());
        } else {
          reader = await status();
          if (authorization && reader.enabled) {
            const current = authorization;
            if (!(await permitted(current.id, current.bindingID))) {
              authorization = null;
              reader = await stopSelectedTelemetry(root, "stopped", clock());
            } else
              reader = await readSelectedTelemetry(
                root,
                clock(),
                undefined,
                () => permitted(current.id, current.bindingID),
              );
          }
          if (!reader.enabled) authorization = null;
        }
      }
    } catch (failure) {
      error = safeError(failure);
      try {
        reader = await status();
      } catch {
        /* Unavailable storage is explicit. */
      }
    }
    await publish(
      join(harnessRoot, "telemetry-result.json"),
      {
        version: 1,
        id: request.id,
        status: error ? "error" : "ok",
        error,
        reader,
      },
      true,
    );
  }
  return {
    root,
    processRequest,
    async stop() {
      stopped = true;
      authorization = null;
      try {
        await stopSelectedTelemetry(root, "stopped", clock());
        if (automatic) await automatic.stop("stopped");
      } finally {
        if (server)
          await new Promise((done) => {
            server.close(done);
            server.closeAllConnections();
          });
        server = null;
      }
    },
  };
}
