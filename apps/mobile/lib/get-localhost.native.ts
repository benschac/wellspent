import Constants from "expo-constants";
import {
  NativeModules,
  type TurboModule,
  TurboModuleRegistry,
} from "react-native";

type DebuggerHostConfig = {
  debuggerHost?: string;
  hostUri?: string;
};

interface SourceCodeModule extends TurboModule {
  getConstants(): { scriptURL?: string };
}

type ExpoManifestExtra = {
  expoGo?: {
    developer?: {
      host?: string;
    };
  };
};

type ExpoConstantsInternals = typeof Constants & {
  expoGoConfig?: DebuggerHostConfig | null;
  manifest?: DebuggerHostConfig | null;
  manifest2?: { extra?: ExpoManifestExtra } | null;
};

const constants = Constants as ExpoConstantsInternals;

const readTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractHostname = (value: string | null | undefined): string | null => {
  const source = readTrimmedString(value);

  if (!source) {
    return null;
  }

  try {
    const url = new URL(source.includes("://") ? source : `http://${source}`);
    return readTrimmedString(url.hostname);
  } catch {
    return null;
  }
};

const readMetroHost = (): string | null => {
  const legacySourceCode = NativeModules.SourceCode as
    | { scriptURL?: string }
    | undefined;
  const sourceCode = TurboModuleRegistry.get<SourceCodeModule>("SourceCode");
  const scriptURL =
    sourceCode?.getConstants().scriptURL ?? legacySourceCode?.scriptURL;
  const candidates = [
    extractHostname(scriptURL),
    extractHostname(constants.expoConfig?.hostUri),
    extractHostname(constants.expoGoConfig?.hostUri),
    extractHostname(constants.expoGoConfig?.debuggerHost),
    extractHostname(constants.manifest?.hostUri),
    extractHostname(constants.manifest?.debuggerHost),
    extractHostname(constants.manifest2?.extra?.expoGo?.developer?.host),
  ];

  return candidates.find((candidate) => candidate !== null) ?? null;
};

let cachedLocalhost: string | null = null;

export const getLocalhost = (): string => {
  const metroHost = readMetroHost();

  if (metroHost) {
    cachedLocalhost = metroHost;
  }

  // Do not cache the fallback. In a development client, SourceCode can be
  // unavailable while the embedded bundle boots and become available once the
  // Metro bundle is running.
  return cachedLocalhost ?? "localhost";
};

export const replaceLocalhost = (address: string): string =>
  address.replace("://localhost:", `://${getLocalhost()}:`);
