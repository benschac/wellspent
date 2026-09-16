import SwiftUI

enum SettingsCategory: String, CaseIterable, Identifiable {
    case accounts = "Accounts"
    case recordings = "Local Recordings"
    case timer = "Timer"
    case floatingSidebar = "Floating Sidebar"
    case connection = "Connection"

    var id: Self { self }

    var symbol: String {
        switch self {
        case .accounts: "person.crop.circle.fill"
        case .recordings: "waveform.path.ecg"
        case .timer: "timer"
        case .floatingSidebar: "sidebar.left"
        case .connection: "network"
        }
    }

    var color: Color {
        switch self {
        case .accounts: .blue
        case .recordings: .green
        case .timer: .orange
        case .floatingSidebar: .purple
        case .connection: .gray
        }
    }
}
