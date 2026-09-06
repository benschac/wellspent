import Foundation

struct TimerSidebarPlacement: Codable, Equatable {
    var displayID: String?
    var x: Double = 1
    var y: Double = 0.5
    var edge: TimerSidebarEdge? = .right

    var floatingOriginEdge: TimerSidebarEdge?

    var isValid: Bool {
        x.isFinite && y.isFinite && (0...1).contains(x) && (0...1).contains(y)
    }
}
