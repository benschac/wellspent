// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LiquidUI",
    platforms: [.macOS(.v14), .iOS(.v16)],
    products: [.library(name: "LiquidUI", targets: ["LiquidUI"])],
    targets: [.target(name: "LiquidUI")]
)
