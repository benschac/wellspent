import { readFile, writeFile } from "node:fs/promises";
import { generateNativeOpenAPI } from "../src/native-openapi.ts";

const destination = new URL("../openapi.native.json", import.meta.url);
const contents = `${JSON.stringify(await generateNativeOpenAPI(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== contents) {
    throw new Error(
      "Native OpenAPI is stale. Run bun run openapi:generate in packages/api-contract.",
    );
  }
} else {
  await writeFile(destination, contents);
}
