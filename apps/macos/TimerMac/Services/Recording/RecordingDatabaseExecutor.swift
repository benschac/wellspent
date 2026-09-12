import Dispatch

/// SQLite may block on disk or a bounded busy timeout; keep it off the UI and cooperative pool.
final class RecordingDatabaseExecutor: SerialExecutor {
    private let queue = DispatchQueue(label: "day.wellspent.recording-database", qos: .utility)

    func enqueue(_ job: consuming ExecutorJob) {
        let job = UnownedJob(job)
        let executor = asUnownedSerialExecutor()
        queue.async { job.runSynchronously(on: executor) }
    }
}
