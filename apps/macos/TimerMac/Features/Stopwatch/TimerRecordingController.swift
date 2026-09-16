import Foundation
import Observation

/// Local button intent couples the stopwatch to capture; remote snapshots never authorize capture.
@MainActor
@Observable
final class TimerRecordingController {
    let recording: RecordingModel
    private(set) var isStarting = false
    private(set) var isBusy = false
    private(set) var errorMessage: String?
    @ObservationIgnored private let timer: TimerModel
    @ObservationIgnored private var operation: Task<Void, Never>?

    init(timer: TimerModel, recording: RecordingModel) {
        self.timer = timer
        self.recording = recording
    }

    var status: String {
        if errorMessage != nil || recording.errorMessage != nil { return "Recording needs attention" }
        if isStarting { return "Starting recording…" }
        if recording.canCaptureForegroundApplications { return "Recording app activity · On this Mac" }
        if recording.isBusy { return "Saving recording…" }
        if recording.current?.capturesForegroundApplications == false {
            return "Sample recording · Finish it to record app activity"
        }
        return recording.current == nil
            ? "Start records app activity on this Mac" : "Recording paused · Resume to capture"
    }

    func toggle() {
        if timer.isRunning || isStarting {
            pause()
        } else {
            start()
        }
    }

    func start() {
        guard !isBusy else { return }
        isBusy = true
        isStarting = true
        errorMessage = nil
        operation = Task {
            defer {
                isStarting = false
                isBusy = false
            }
            recording.load()
            await recording.waitForIdle()
            guard !Task.isCancelled else { return }
            guard recording.canAct, recording.errorMessage == nil else {
                errorMessage = "Recording could not start. Open Local recordings to retry the save or load."
                return
            }
            if let current = recording.current {
                guard current.capturesForegroundApplications else {
                    errorMessage = "Finish the sample recording in Local recordings before starting the timer."
                    return
                }
                if current.status != .recording { recording.resume() }
            } else {
                recording.startForegroundApplicationRecording()
            }
            await recording.waitForIdle()
            guard !Task.isCancelled else { return }
            guard recording.canCaptureForegroundApplications else {
                errorMessage = "Recording did not start. Open Local recordings to inspect its status and retry."
                return
            }
            timer.startOrResume()
        }
    }

    func pause() {
        operation?.cancel()
        isStarting = false
        recording.pauseFromTimer()
        timer.pause()
    }

    func waitForIdle() async {
        await operation?.value
        await recording.waitForIdle()
    }

    func cancelPendingStart() {
        operation?.cancel()
        isStarting = false
    }
}
