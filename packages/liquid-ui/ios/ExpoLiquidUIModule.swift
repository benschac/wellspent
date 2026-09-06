import ExpoModulesCore
import ExpoUI

public final class ExpoLiquidUIModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoLiquidUI")
        ExpoUIView(ExpoLiquidView.self)
    }
}
