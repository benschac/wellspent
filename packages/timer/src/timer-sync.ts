import type { RealtimeTimerState } from "@repo/api-contract";
import {
  formatTimerSyncMessage,
  type TimerSyncProblem,
} from "./timer-sync-format";
import type { TimerSyncMessage } from "./timer-sync-message";

export type TimerSyncStatus = "connecting" | "connected" | "offline" | "error";

export interface TimerSyncState {
  status: TimerSyncStatus;
  pendingCount: number;
  lastConfirmedRevision: number | null;
  endpoint: string;
  message: string;
}

export type SocketConnectionStatus =
  | "connecting"
  | "open"
  | "offline"
  | "error";

/** Diagnostics must never expose credentials, query tokens, or fragments. */
export function safeTimerEndpoint(url: string | undefined): string {
  if (!url) return "Not configured";
  try {
    const parsed = new URL(url);
    if (!["ws:", "wss:", "http:", "https:"].includes(parsed.protocol))
      return "Invalid endpoint";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "Invalid endpoint";
  }
}

type PendingAction = {
  status: "queued" | "sent" | "unconfirmed" | "failed";
  timeout?: ReturnType<typeof setTimeout>;
};

/** Correlation is not idempotency: an attempted send is never blindly replayed. */
export class TimerSyncTracker {
  private connection: SocketConnectionStatus;
  private hasSnapshot = false;
  private revision: number | null = null;
  private problem: TimerSyncProblem | null = null;
  private pending = new Map<string, PendingAction>();
  private snapshotTimeout?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(
    private readonly url: string | undefined,
    private readonly changed: (state: TimerSyncState) => void,
    private readonly timeoutMs = 15_000,
  ) {
    this.connection = url ? "connecting" : "offline";
  }

  get state(): TimerSyncState {
    const uncertain = [...this.pending.values()].some(
      (action) => action.status === "unconfirmed" || action.status === "failed",
    );
    const status: TimerSyncStatus =
      this.connection === "offline"
        ? "offline"
        : this.connection === "error" || this.problem || uncertain
          ? "error"
          : this.connection !== "open" || !this.hasSnapshot
            ? "connecting"
            : "connected";
    return {
      status,
      pendingCount: this.pending.size,
      lastConfirmedRevision: this.revision,
      endpoint: safeTimerEndpoint(this.url),
      message: formatTimerSyncMessage({
        configured: Boolean(this.url),
        uncertain,
        problem: this.problem,
        pendingCount: this.pending.size,
        status,
      }),
    };
  }

  receive(message: TimerSyncMessage): RealtimeTimerState | null {
    if (this.disposed) return null;
    switch (message.type) {
      case "state":
        this.receivedState(message.state.revision);
        return message.state;
      case "acknowledgement":
        return this.acknowledged(message.commandId, message.state.revision)
          ? message.state
          : null;
      case "rejection":
        this.rejected(message.commandId);
        return null;
      case "invalid":
        this.invalidMessage();
        return null;
      case "ignored":
        return null;
    }
  }

  private publish() {
    if (!this.disposed) this.changed(this.state);
  }

  connectionChanged(status: SocketConnectionStatus) {
    if (this.disposed) return;
    this.connection = status;
    clearTimeout(this.snapshotTimeout);
    if (status === "open") {
      this.hasSnapshot = false;
      this.snapshotTimeout = setTimeout(() => {
        this.problem = "snapshot-timeout";
        this.publish();
      }, this.timeoutMs);
    } else {
      this.hasSnapshot = false;
      for (const action of this.pending.values()) {
        if (action.status !== "sent") continue;
        clearTimeout(action.timeout);
        action.status = "unconfirmed";
      }
      if (status === "error") this.problem = "connection-error";
    }
    this.publish();
  }

  receivedState(revision: number) {
    if (this.disposed) return;
    this.hasSnapshot = true;
    this.connection = "open";
    this.revision = Math.max(this.revision ?? -1, revision);
    this.problem = null;
    clearTimeout(this.snapshotTimeout);
    this.publish();
  }

  queued(commandId: string) {
    if (this.disposed) return;
    this.pending.set(commandId, { status: "queued" });
    this.publish();
  }

  sent(commandId: string) {
    const action = this.pending.get(commandId);
    if (!action || this.disposed) return;
    action.status = "sent";
    action.timeout = setTimeout(() => {
      action.status = "unconfirmed";
      this.publish();
    }, this.timeoutMs);
    this.publish();
  }

  acknowledged(commandId: string, revision: number): boolean {
    const action = this.pending.get(commandId);
    if (!action || action.status === "queued" || this.disposed) return false;
    clearTimeout(action.timeout);
    this.pending.delete(commandId);
    this.receivedState(revision);
    return true;
  }

  rejected(commandId?: string) {
    const action = commandId ? this.pending.get(commandId) : undefined;
    if (action) {
      clearTimeout(action.timeout);
      action.status = "failed";
    }
    this.problem = "action-rejected";
    this.publish();
  }

  invalidMessage() {
    this.problem = "invalid-response";
    this.publish();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.snapshotTimeout);
    for (const action of this.pending.values()) clearTimeout(action.timeout);
    this.pending.clear();
  }
}
