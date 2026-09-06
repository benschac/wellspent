import ExpoModulesCore
import ExpoUI
import SwiftUI

struct ExpoLiquidView: ExpoSwiftUI.View {
    @ObservedObject var props: ExpoLiquidViewProps
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var offset: CGSize = .zero
    @State private var attached = true
    @GestureState private var translation: CGSize? = nil

    init(props: ExpoLiquidViewProps) {
        self.props = props
    }

    private var edge: TimerSidebarEdge {
        TimerSidebarEdge(rawValue: props.edge) ?? .right
    }

    private var settlingAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 1)
    }

    var body: some View {
        GeometryReader { geometry in
            let frame = bodyFrame(in: geometry.size, translation: translation ?? .zero)
            let gap = distanceFromEdge(frame, in: geometry.size)
            let detachment: CGFloat = attached || translation != nil ? min(1, gap / 140) : 1

            ZStack(alignment: .topLeading) {
                LiquidPresentation(
                    bodyFrame: frame,
                    detachment: detachment,
                    edge: edge,
                    containerSize: geometry.size
                )

                Image(systemName: "drop.fill")
                    .font(.title)
                    .foregroundStyle(.primary)
                    .frame(width: frame.width, height: frame.height)
                    .contentShape(Rectangle())
                    .position(x: frame.midX, y: frame.midY)
                    .gesture(drag(in: geometry.size))
                    .accessibilityLabel("Liquid handle")
                    .accessibilityValue(attached ? "Attached to the \(edge.rawValue) edge" : "Floating")
                    .accessibilityHint("Drag away from the edge to detach. Move it back to attach.")
                    .accessibilityAction(named: Text("Reattach")) { reset() }
                    .accessibilityAction(named: Text("Detach")) {
                        withAnimation(settlingAnimation) {
                            offset = detachingOffset
                            setAttached(false)
                        }
                    }
            }
            .coordinateSpace(name: "liquidCanvas")
            .clipped()
            .onChange(of: geometry.size) { _ in reset() }
        }
        .onChange(of: props.edge) { _ in reset() }
        .onChange(of: props.resetKey) { _ in reset() }
    }

    private var detachingOffset: CGSize {
        switch edge {
        case .left: CGSize(width: 80, height: 0)
        case .right: CGSize(width: -80, height: 0)
        case .top: CGSize(width: 0, height: 80)
        case .bottom: CGSize(width: 0, height: -80)
        }
    }

    private func drag(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named("liquidCanvas"))
            .updating($translation) { value, state, _ in
                state = value.translation
            }
            .onEnded { value in
                let frame = bodyFrame(in: size, translation: value.translation)
                let base = attachedFrame(in: size)
                let shouldAttach = distanceFromEdge(frame, in: size) <= TimerLiquidShape.separationDistance
                withAnimation(settlingAnimation) {
                    if shouldAttach {
                        offset =
                            edge.isHorizontal
                            ? CGSize(width: frame.minX - base.minX, height: 0)
                            : CGSize(width: 0, height: frame.minY - base.minY)
                    } else {
                        offset = CGSize(width: frame.minX - base.minX, height: frame.minY - base.minY)
                    }
                    setAttached(shouldAttach)
                }
            }
    }

    private func attachedFrame(in size: CGSize) -> CGRect {
        let naturalSize = TimerSidebarGeometry(horizontal: edge.isHorizontal ? 1 : 0, detachment: 0).size
        let bodySize = CGSize(width: min(naturalSize.width, size.width), height: min(naturalSize.height, size.height))
        let center = CGPoint(x: (size.width - bodySize.width) / 2, y: (size.height - bodySize.height) / 2)
        let origin: CGPoint
        switch edge {
        case .left: origin = CGPoint(x: 0, y: center.y)
        case .right: origin = CGPoint(x: size.width - bodySize.width, y: center.y)
        case .top: origin = CGPoint(x: center.x, y: 0)
        case .bottom: origin = CGPoint(x: center.x, y: size.height - bodySize.height)
        }
        return CGRect(origin: origin, size: bodySize)
    }

    private func bodyFrame(in size: CGSize, translation: CGSize) -> CGRect {
        let base = attachedFrame(in: size)
        return CGRect(
            x: min(max(0, base.minX + offset.width + translation.width), max(0, size.width - base.width)),
            y: min(max(0, base.minY + offset.height + translation.height), max(0, size.height - base.height)),
            width: base.width, height: base.height
        )
    }

    private func distanceFromEdge(_ frame: CGRect, in size: CGSize) -> CGFloat {
        switch edge {
        case .left: frame.minX
        case .right: size.width - frame.maxX
        case .top: frame.minY
        case .bottom: size.height - frame.maxY
        }
    }

    private func setAttached(_ value: Bool) {
        guard attached != value else { return }
        attached = value
        props.onAttachmentChange(["attached": value, "edge": edge.rawValue])
    }

    private func reset() {
        withAnimation(settlingAnimation) {
            offset = .zero
            setAttached(true)
        }
    }
}
