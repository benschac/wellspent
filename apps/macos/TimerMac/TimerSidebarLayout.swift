import Foundation
import LiquidUI

enum TimerSidebarLayout {
    static let snapDistance: CGFloat = 78

    static func size(for edge: TimerSidebarEdge?) -> CGSize {
        TimerSidebarGeometry.size(for: edge)
    }

    static func frame(for placement: TimerSidebarPlacement, in visibleFrame: CGRect) -> CGRect {
        let desiredSize = size(for: placement.edge)
        let size = CGSize(
            width: min(desiredSize.width, visibleFrame.width),
            height: min(desiredSize.height, visibleFrame.height)
        )
        var x = visibleFrame.minX + (visibleFrame.width - size.width) * placement.x
        var y = visibleFrame.minY + (visibleFrame.height - size.height) * placement.y
        switch placement.edge {
        case .left: x = visibleFrame.minX
        case .right: x = visibleFrame.maxX - size.width
        case .top: y = visibleFrame.maxY - size.height
        case .bottom: y = visibleFrame.minY
        case nil: break
        }
        return CGRect(x: x, y: y, width: size.width, height: size.height)
    }

    static func placement(
        afterDropping releasedFrame: CGRect,
        in visibleFrame: CGRect,
        displayID: String?,
        magneticEdges: Bool,
        preferredEdge: TimerSidebarEdge?
    ) -> TimerSidebarPlacement {
        let distances: [(TimerSidebarEdge, CGFloat)] = [
            (.left, max(0, releasedFrame.minX - visibleFrame.minX)),
            (.right, max(0, visibleFrame.maxX - releasedFrame.maxX)),
            (.top, max(0, visibleFrame.maxY - releasedFrame.maxY)),
            (.bottom, max(0, releasedFrame.minY - visibleFrame.minY)),
        ]
        // At a corner, preserve the previous edge when distances tie.
        let nearest = distances.min { first, second in
            if abs(first.1 - second.1) < 0.5 { return first.0 == preferredEdge }
            return first.1 < second.1
        }
        let edge = magneticEdges && (nearest?.1 ?? .infinity) <= snapDistance ? nearest?.0 : nil
        let size = size(for: edge)
        let availableX = max(0, visibleFrame.width - size.width)
        let availableY = max(0, visibleFrame.height - size.height)
        // Preserve the dropped center while adapting to a new orientation.
        let x = availableX > 0 ? (releasedFrame.midX - size.width / 2 - visibleFrame.minX) / availableX : 0
        let y = availableY > 0 ? (releasedFrame.midY - size.height / 2 - visibleFrame.minY) / availableY : 0
        return TimerSidebarPlacement(
            displayID: displayID,
            x: min(1, max(0, x)),
            y: min(1, max(0, y)),
            edge: edge
        )
    }
}
