import SwiftUI

struct SettingsView: View {
    @Environment(TimerWindowCoordinator.self) private var windows

    var body: some View {
        @Bindable var windows = windows

        NavigationSplitView(columnVisibility: .constant(.all)) {
            List(SettingsCategory.allCases, selection: $windows.selectedSettingsCategory) { category in
                SettingsSidebarLabel(category: category)
                    .tag(category)
            }
            .listStyle(.sidebar)
            .frame(width: 220)
            .navigationSplitViewColumnWidth(220)
            .background(SettingsSidebarLock())
            .toolbar(removing: .sidebarToggle)
        } detail: {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text((windows.selectedSettingsCategory ?? .accounts).rawValue)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                }
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 12)

                if windows.selectedSettingsCategory == .recordings {
                    RecordingWindowView()
                } else {
                    SettingsDetailView(selectedCategory: windows.selectedSettingsCategory ?? .accounts)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .navigationTitle("Timer Settings")
        .frame(minWidth: 1000, minHeight: 580)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SettingsFrostedBackdrop().ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}
