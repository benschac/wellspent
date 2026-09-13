import Foundation

/// One composition per app process. Construction is inert; the delegate owns lifecycle.
@MainActor
final class TimerAppComposition {
    let model: TimerModel
    let focusModel: FocusModel
    let focusAuth: FocusAuthModel
    let recording: RecordingModel
    private lazy var foregroundApplicationMonitor = ForegroundApplicationMonitor(recording: recording)
    private let defaults: UserDefaults
    private var isStarted = false
    private var isShutDown = false
    private var preparationTask: Task<Void, Never>?
    private var resumeTask: Task<Void, Never>?

    lazy var sidebar: TimerSidebarController = {
        let sidebar = TimerSidebarController(model: model, defaults: defaults)
        sidebar.openSettings = { [weak self] in self?.windows.showSettings() }
        sidebar.openTimerWindow = { [weak self] in self?.windows.showMainWindow() }
        sidebar.quitApplication = { [weak self] in self?.windows.quit() }
        return sidebar
    }()

    lazy var windows = TimerWindowCoordinator(
        model: model, sidebar: sidebar, focusModel: focusModel, focusAuth: focusAuth, recording: recording,
        prepareFocus: { [weak self] in await self?.prepareFocus() })

    init(
        model: TimerModel = TimerModel(), focusModel: FocusModel = FocusModel(),
        focusAuth: FocusAuthModel = FocusAuthModel(), defaults: UserDefaults = .standard,
        recording: RecordingModel = RecordingModel()
    ) {
        self.model = model
        self.focusModel = focusModel
        self.focusAuth = focusAuth
        self.recording = recording
        self.defaults = defaults
        focusModel.authenticatedConnection = { [weak focusAuth] in
            guard let focusAuth else { throw CancellationError() }
            return try await focusAuth.connection()
        }
        focusModel.authenticationRejected = { [weak focusAuth] in focusAuth?.requireSignIn() }
        focusAuth.accountChanged = { [weak model, weak focusModel, weak focusAuth] in
            guard let model, let focusModel, let focusAuth else { return }
            focusModel.configureAccount(
                apiBaseURL: model.apiBaseURL, userID: focusAuth.user?.id, available: focusAuth.canAccess)
        }
    }

    func start() {
        guard !isStarted, !isShutDown else { return }
        isStarted = true
        model.start()
        recording.captureStateDidChange = { [weak self] in self?.foregroundApplicationMonitor.synchronize() }
        foregroundApplicationMonitor.synchronize()
        sidebar.restore()
        preparationTask = Task { [weak self] in await self?.prepareFocus() }
    }

    func prepareFocus() async {
        guard !isShutDown else { return }
        await focusAuth.configure(apiBaseURL: model.apiBaseURL)
    }

    func resumeFocus() {
        guard isStarted, !isShutDown, resumeTask == nil else { return }
        resumeTask = Task { [weak self] in
            guard let self else { return }
            defer { resumeTask = nil }
            await preparationTask?.value
            guard !Task.isCancelled else { return }
            await focusAuth.resume()
        }
    }

    @discardableResult
    func shutdown() async -> Bool {
        guard !isShutDown else { return true }
        guard await recording.shutdown() else { return false }
        foregroundApplicationMonitor.stopObserving()
        isShutDown = true
        preparationTask?.cancel()
        resumeTask?.cancel()
        windows.shutdown()
        sidebar.shutdown()
        focusAuth.shutdown()
        await model.shutdown()
        return true
    }
}
