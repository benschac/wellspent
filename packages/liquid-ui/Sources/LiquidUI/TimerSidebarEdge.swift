import Foundation

public enum TimerSidebarEdge: String, Codable, CaseIterable, Sendable {
    case left, right, top, bottom

    public var isHorizontal: Bool { self == .top || self == .bottom }
}
