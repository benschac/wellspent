const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const targetName = "TimerLiveActivityExtension";
const infoPlistFile = `${targetName}-Info.plist`;
const sourceFiles = [
  "TimerLiveActivityAttributes.swift",
  "TimerLiveActivityIntent.swift",
  "TimerLiveActivityWidget.swift",
  "TimerLiveActivityBundle.swift",
];

const addEasExtension = (config, bundleIdentifier) => {
  const current =
    config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  const extension = { targetName, bundleIdentifier };
  const appExtensions = current.some((item) => item.targetName === targetName)
    ? current.map((item) =>
        item.targetName === targetName ? { ...item, ...extension } : item,
      )
    : [...current, extension];

  config.extra = {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      build: {
        ...config.extra?.eas?.build,
        experimental: {
          ...config.extra?.eas?.build?.experimental,
          ios: {
            ...config.extra?.eas?.build?.experimental?.ios,
            appExtensions,
          },
        },
      },
    },
  };

  return config;
};

const addTargetGroup = (project) => {
  if (project.pbxGroupByName(targetName)) {
    return;
  }

  const { uuid } = project.addPbxGroup(
    [...sourceFiles, infoPlistFile],
    targetName,
    targetName,
  );
  const groups = project.hash.project.objects.PBXGroup;

  for (const key of Object.keys(groups)) {
    if (groups[key].name === undefined && groups[key].path === undefined) {
      project.addToPbxGroup(uuid, key);
    }
  }
};

const configureTargetBuildSettings = (
  project,
  target,
  config,
  bundleIdentifier,
) => {
  const configurationList =
    project.pbxXCConfigurationList()[
      target.pbxNativeTarget.buildConfigurationList
    ];
  const configurations = project.pbxXCBuildConfigurationSection();
  const deploymentTarget = config.ios?.deploymentTarget ?? "16.4";
  const marketingVersion = config.ios?.version ?? config.version ?? "1.0";
  const buildNumber = config.ios?.buildNumber ?? "1";

  for (const item of configurationList.buildConfigurations) {
    const settings = configurations[item.value].buildSettings;
    Object.assign(settings, {
      APPLICATION_EXTENSION_API_ONLY: "YES",
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: `"${buildNumber}"`,
      GENERATE_INFOPLIST_FILE: "YES",
      INFOPLIST_FILE: `"${targetName}/${infoPlistFile}"`,
      INFOPLIST_KEY_CFBundleDisplayName: '"Timer Live Activity"',
      IPHONEOS_DEPLOYMENT_TARGET: `"${deploymentTarget}"`,
      LD_RUNPATH_SEARCH_PATHS:
        '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
      MARKETING_VERSION: `"${marketingVersion}"`,
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}"`,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SKIP_INSTALL: "YES",
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: '"1,2"',
    });

    if (config.ios?.appleTeamId) {
      settings.DEVELOPMENT_TEAM = config.ios.appleTeamId;
    }
  }
};

const addExtensionTarget = (project, config, bundleIdentifier) => {
  if (project.findTargetKey(targetName)) {
    return;
  }

  const target = project.addTarget(
    targetName,
    "app_extension",
    targetName,
    bundleIdentifier,
  );

  configureTargetBuildSettings(project, target, config, bundleIdentifier);
  project.addBuildPhase(
    sourceFiles,
    "PBXSourcesBuildPhase",
    "Sources",
    target.uuid,
    "app_extension",
    '""',
  );
  project.addBuildPhase(
    [],
    "PBXFrameworksBuildPhase",
    "Frameworks",
    target.uuid,
    "app_extension",
    '""',
  );
  addTargetGroup(project);

  const pbxProject =
    project.pbxProjectSection()[project.getFirstProject().uuid];
  pbxProject.attributes.TargetAttributes ??= {};
  pbxProject.attributes.TargetAttributes[target.uuid] = {
    LastSwiftMigration: 1600,
  };
};

const withTimerLiveActivity = (config) => {
  const appBundleIdentifier = config.ios?.bundleIdentifier;
  if (!appBundleIdentifier) {
    throw new Error("TimerLiveActivity requires ios.bundleIdentifier.");
  }
  const extensionBundleIdentifier = `${appBundleIdentifier}.${targetName}`;

  config = addEasExtension(config, extensionBundleIdentifier);

  config = withEntitlementsPlist(config, (nextConfig) => {
    nextConfig.modResults["aps-environment"] ??= "development";
    return nextConfig;
  });

  config = withInfoPlist(config, (nextConfig) => {
    nextConfig.modResults.NSSupportsLiveActivities = true;
    return nextConfig;
  });

  config = withDangerousMod(config, [
    "ios",
    async (nextConfig) => {
      const projectRoot = nextConfig.modRequest.projectRoot;
      const targetDirectory = path.join(
        nextConfig.modRequest.platformProjectRoot,
        targetName,
      );
      const moduleRoot = path.join(
        projectRoot,
        "modules",
        "timer-live-activity",
      );
      const sources = {
        "TimerLiveActivityAttributes.swift": path.join(
          moduleRoot,
          "ios",
          "TimerLiveActivityAttributes.swift",
        ),
        "TimerLiveActivityIntent.swift": path.join(
          moduleRoot,
          "ios",
          "TimerLiveActivityIntent.swift",
        ),
        "TimerLiveActivityWidget.swift": path.join(
          moduleRoot,
          "widget",
          "TimerLiveActivityWidget.swift",
        ),
        "TimerLiveActivityBundle.swift": path.join(
          moduleRoot,
          "widget",
          "TimerLiveActivityBundle.swift",
        ),
      };

      fs.rmSync(targetDirectory, { recursive: true, force: true });
      fs.mkdirSync(targetDirectory, { recursive: true });

      for (const [fileName, sourcePath] of Object.entries(sources)) {
        fs.copyFileSync(sourcePath, path.join(targetDirectory, fileName));
      }

      const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Timer Live Activity</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
`;
      fs.writeFileSync(path.join(targetDirectory, infoPlistFile), infoPlist);

      return nextConfig;
    },
  ]);

  return withXcodeProject(config, (nextConfig) => {
    addExtensionTarget(
      nextConfig.modResults,
      nextConfig,
      extensionBundleIdentifier,
    );
    return nextConfig;
  });
};

module.exports = withTimerLiveActivity;
