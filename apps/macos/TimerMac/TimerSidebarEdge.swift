import Foundation

enum TimerSidebarEdge: String, Codable, CaseIterable {
    case left, right, top, bottom

    var isHorizontal: Bool { self == .top || self == .bottom }
}
