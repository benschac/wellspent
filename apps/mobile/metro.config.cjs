const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Skia 2.11.2 still imports the registry removed in RN 0.88. Use the public
  // entry point so Expo supplies the same registry used by bundled assets.
  const resolvedName =
    moduleName === "react-native/Libraries/Image/AssetRegistry"
      ? "react-native/asset-registry"
      : moduleName;

  return context.resolveRequest(context, resolvedName, platform);
};

module.exports = config;
