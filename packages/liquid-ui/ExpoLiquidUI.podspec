Pod::Spec.new do |s|
  s.name           = 'ExpoLiquidUI'
  s.version        = '1.0.0'
  s.summary        = 'Shared native liquid animation'
  s.description    = 'SwiftUI liquid geometry shared by the macOS app and the Expo iOS view.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoUI'
  s.swift_version = '6.0'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "Sources/LiquidUI/**/*.swift", "ios/**/*.swift"
end
