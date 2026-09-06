import ExpoModulesCore
import ExpoUI

final class ExpoLiquidViewProps: UIBaseViewProps {
    @Field var edge: String = "right"
    @Field var resetKey: Int = 0
    var onAttachmentChange = EventDispatcher()
}
