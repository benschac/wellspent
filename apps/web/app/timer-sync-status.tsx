import type { Stopwatch } from "@repo/timer";

const syncStatusLabels = {
  connecting: "Connecting",
  connected: "Connected",
  offline: "Offline",
  error: "Sync error",
};

export function TimerSyncStatus({ sync }: Pick<Stopwatch, "sync">) {
  return (
    <div className="timer-sync">
      <div aria-live="polite" aria-atomic="true" role="status">
        <p className={`timer-sync__status timer-sync__status--${sync.status}`}>
          {syncStatusLabels[sync.status]}
        </p>
        <p className="timer-sync__message">{sync.message}</p>
      </div>
      <details className="timer-sync__diagnostics">
        <summary>Connection details</summary>
        <dl>
          <dt>API WebSocket</dt>
          <dd>{sync.endpoint || "Not configured"}</dd>
          <dt>Unconfirmed actions</dt>
          <dd>{sync.pendingCount}</dd>
          <dt>Last confirmed revision</dt>
          <dd>{sync.lastConfirmedRevision ?? "None yet"}</dd>
        </dl>
      </details>
    </div>
  );
}
