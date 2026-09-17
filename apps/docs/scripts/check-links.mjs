import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Validate the actual pre-rendered HTML, including MDX cards and generated API pages.
const root = fileURLToPath(new URL("../.next/server/app/", import.meta.url));
const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    return item.isDirectory()
      ? htmlFiles(path)
      : item.name.endsWith(".html")
        ? [path]
        : [];
  });
}
const pages = new Map(
  htmlFiles(root).map((path) => [
    `/${relative(root, path).replace(/\.html$/, "")}`,
    readFileSync(path, "utf8"),
  ]),
);
const failures = new Set();
let checked = 0;
for (const [page, html] of pages) {
  if (!page.startsWith("/docs")) continue;
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const href = match[1];
    if (
      !href ||
      (!href.startsWith("/docs") &&
        !href.startsWith("/repository/") &&
        !href.startsWith("#"))
    )
      continue;
    const url = new URL(
      href.replaceAll("&amp;", "&"),
      `http://docs.local${page}`,
    );
    checked++;
    if (url.pathname.startsWith("/repository/")) {
      if (!existsSync(join(publicRoot, decodeURIComponent(url.pathname))))
        failures.add(`${page}: missing asset ${href}`);
      continue;
    }
    const target = pages.get(
      decodeURIComponent(url.pathname).replace(/\/$/, ""),
    );
    if (!target) failures.add(`${page}: missing page ${href}`);
    else if (
      url.hash &&
      !target.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`)
    )
      failures.add(`${page}: missing anchor ${href}`);
  }
}
if (failures.size) {
  console.error([...failures].join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `PASS: ${checked} links/assets across ${[...pages.keys()].filter((p) => p.startsWith("/docs")).length} rendered documentation pages.`,
  );
