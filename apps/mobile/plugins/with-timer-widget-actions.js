const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

module.exports = function withTimerWidgetActions(config) {
  return withDangerousMod(config, [
    "ios",
    async (nextConfig) => {
      const widgetPath = path.join(
        nextConfig.modRequest.platformProjectRoot,
        "ExpoWidgetsTarget",
        "TimerWidget.swift",
      );
      const sourcePath = path.join(
        nextConfig.modRequest.projectRoot,
        "plugins",
        "TimerWidget.swift",
      );

      if (!fs.existsSync(widgetPath)) {
        throw new Error(
          "TimerWidget.swift was not generated. Run this plugin after expo-widgets.",
        );
      }

      fs.copyFileSync(sourcePath, widgetPath);
      return nextConfig;
    },
  ]);
};
