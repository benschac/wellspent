import LiquidUI
import SwiftUI
import Testing

@testable import TimerMac

struct TimerSidebarMotionTests {
    @Test func shouldersRetractBeforeTheLayoutFinishesMorphing() {
        let rect = CGRect(x: 0, y: 0, width: 160, height: 180)
        let rounded = TimerSidebarShape(edge: nil).path(in: rect)
        for edge in TimerSidebarEdge.allCases {
            let pulled = TimerSidebarShape(edge: edge, detachment: 0.25).path(in: rect)
            #expect(pulled == rounded)
        }
    }

    @Test func attachedControlsHaveEqualInsetsInsideTheShoulders() {
        for edge in TimerSidebarEdge.allCases {
            let geometry = TimerSidebarGeometry(
                horizontal: edge.isHorizontal ? 1 : 0,
                floatingFlip: edge == .right ? 1 : 0, detachment: 0)
            let inset = TimerSidebarGeometry.shoulder + TimerSidebarGeometry.contentInset
            if edge.isHorizontal {
                #expect(geometry.ring.x - 24 == inset)
                #expect(geometry.size.width - geometry.settings.x - 18 == inset)
            } else {
                #expect(geometry.ring.y - 24 == inset)
                #expect(geometry.size.height - geometry.settings.y - 18 == inset)
            }
            let path = TimerSidebarShape(edge: edge).path(in: CGRect(origin: .zero, size: geometry.size))
            for step in 0..<32 {
                let angle = Double(step) * .pi / 16
                let point = CGPoint(
                    x: geometry.settings.x + cos(angle) * 18,
                    y: geometry.settings.y + sin(angle) * 18)
                #expect(path.contains(point))
            }
        }
    }

    @Test func morphStartsImmediatelyAndReversesWithoutAHysteresisJump() {
        for edge in TimerSidebarEdge.allCases {
            func translation(_ distance: CGFloat) -> CGPoint {
                switch edge {
                case .right: CGPoint(x: -distance, y: 0)
                case .left: CGPoint(x: distance, y: 0)
                case .top: CGPoint(x: 0, y: -distance)
                case .bottom: CGPoint(x: 0, y: distance)
                }
            }
            let samples = (0...140).map {
                TimerSidebarGeometry.detachment(edge: edge, translation: translation(CGFloat($0)))
            }
            #expect(samples[0] == 0)
            #expect(samples[1] > 0)
            #expect(samples[140] == 1)
            for index in 1..<samples.count {
                #expect(samples[index] >= samples[index - 1])
                #expect(samples[index] - samples[index - 1] < 0.011)
            }
            #expect(TimerSidebarGeometry.detachment(edge: edge, translation: translation(-30)) == 0)
        }
    }

    @Test func grabbedContentStaysUnderPointerThroughoutMorph() {
        let pointer = CGPoint(x: -410, y: 520)
        let offset = CGPoint(x: 7, y: -9)
        for flip: CGFloat in [0, 1] {
            for step in 0...100 {
                let geometry = TimerSidebarGeometry(horizontal: CGFloat(step) / 100, floatingFlip: flip)
                for byRing in [true, false] {
                    let frame = geometry.frame(holding: pointer, offset: offset, byRing: byRing)
                    let anchor = byRing ? geometry.ring : geometry.label
                    #expect(abs(frame.minX + anchor.x + offset.x - pointer.x) < 0.001)
                    #expect(abs(frame.maxY - anchor.y - offset.y - pointer.y) < 0.001)
                    #expect(CGRect(origin: .zero, size: geometry.size).contains(geometry.face))
                }
            }
        }
    }

    @Test func detachedOutlineIsIndependentOfItsFormerEdge() {
        let rect = CGRect(x: 0, y: 0, width: 244, height: 80)
        for edge in TimerSidebarEdge.allCases {
            let path = TimerSidebarShape(edge: edge, detachment: 1).path(in: rect)
            #expect(path.contains(CGPoint(x: 122, y: 40)))
            #expect(path.contains(CGPoint(x: 5, y: 40)))
            #expect(!path.contains(CGPoint(x: 1, y: 1)))
            #expect(path.boundingRect == rect)
            let reference = TimerSidebarShape(edge: .right, detachment: 1).path(in: rect)
            for x in stride(from: 1, through: 243, by: 3) {
                for y in stride(from: 1, through: 79, by: 3) {
                    let point = CGPoint(x: x, y: y)
                    #expect(path.contains(point) == reference.contains(point))
                }
            }
        }
    }

    @Test @MainActor func settlingArrivesWithoutOvershootingScreenEdge() {
        var previous: CGFloat = 0
        for step in 0...60 {
            let progress = TimerMotionClock.settlingProgress(at: Double(step) / 120)
            #expect(progress >= previous)
            #expect((0...1).contains(progress))
            previous = progress
        }
        #expect(previous > 0.999)
    }

}
