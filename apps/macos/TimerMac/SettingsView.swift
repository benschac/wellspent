import SwiftUI

struct SettingsView: View {
    @State private var selectedCategory: SettingsCategory? = .accounts

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            List(SettingsCategory.allCases, selection: $selectedCategory) { category in
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
                Text((selectedCategory ?? .accounts).rawValue)
                    .font(.title2.bold())
                    .padding(.horizontal, 24)
                    .padding(.top, 20)
                    .padding(.bottom, 12)
                    .accessibilityAddTraits(.isHeader)

                SettingsDetailView(selectedCategory: selectedCategory ?? .accounts)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .navigationTitle("Timer Settings")
        .frame(minWidth: 740, minHeight: 580)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SettingsFrostedBackdrop().ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}
