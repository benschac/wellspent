Pod::Spec.new do |s|
  s.name           = 'TimerLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Native ActivityKit support for the Timer app'
  s.description    = 'Owns the Timer Live Activity lifecycle and ActivityKit attributes.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
