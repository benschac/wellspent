import SwiftUI

struct TimerWorkspaceNavigationView: View {
    @Environment(TimerWindowCoordinator.self) private var windows

    var body: some View {
        HStack {
            Button("Local Recordings…", systemImage: "waveform.path.ecg", action: windows.showRecordingWindow)
                .accessibilityIdentifier("open-local-recordings")
            Button("Open Focus", systemImage: "scope", action: windows.showFocusWindow)
            Spacer()
            Button("Settings…", systemImage: "gearshape", action: windows.showSettings)
        }
        .buttonStyle(.bordered)
    }
}
