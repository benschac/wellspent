import AppKit

final class SettingsSidebarLockView: NSView {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        lockSidebar()
        // Hosting can finish attaching its split controller after this callback.
        DispatchQueue.main.async { [weak self] in self?.lockSidebar() }
    }

    override func layout() {
        super.layout()
        lockSidebar()
    }

    func lockSidebar() {
        var ancestor = superview
        while let view = ancestor {
            if let splitView = view as? NSSplitView,
                let controller = splitView.delegate as? NSSplitViewController,
                let item = controller.splitViewItems.first(where: { $0.behavior == .sidebar })
            {
                if item.canCollapse { item.canCollapse = false }
                if item.canCollapseFromWindowResize { item.canCollapseFromWindowResize = false }
                if item.minimumThickness != 220 { item.minimumThickness = 220 }
                if item.maximumThickness != 220 { item.maximumThickness = 220 }
                if item.isCollapsed { item.isCollapsed = false }
                return
            }
            ancestor = view.superview
        }
    }
}
