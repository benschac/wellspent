import { posix } from "node:path";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkStringify);

const documentationAssetExtensions = new Set([
  ".entitlements",
  ".json",
  ".md",
  ".mjs",
  ".mmd",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
]);

export function isAllowedDocumentationAsset(target) {
  return (
    documentationAssetExtensions.has(posix.extname(target)) ||
    ["LICENSE", "COMMERCIAL-LICENSE.md", "CONTRIBUTING.md"].includes(target)
  );
}

export function resolveLocalLink(source, url) {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return null;
  const match = /^([^?#]*)(.*)$/.exec(url);
  if (!match) return null;
  const path = decodeURIComponent(match[1] ?? "");
  if (path.startsWith("/"))
    throw new Error(`Absolute local link in ${source}: ${url}`);
  const target = posix.normalize(posix.join(posix.dirname(source), path));
  if (target.startsWith("../"))
    throw new Error(`Link leaves repository: ${source}: ${url}`);
  return { target, suffix: match[2] ?? "" };
}

export function transformMarkdown(raw, source, resolve) {
  const tree = markdown.parse(
    raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""),
  );
  const first = tree.children[0];
  const title =
    first?.type === "heading" && first.depth === 1
      ? first.children
          .map((node) => ("value" in node ? node.value : ""))
          .join("")
      : posix.basename(source, ".md");
  if (first?.type === "heading" && first.depth === 1) tree.children.shift();
  visit(tree, (node) => {
    if (
      node.type === "link" ||
      node.type === "image" ||
      node.type === "definition"
    ) {
      const local = resolveLocalLink(source, node.url);
      if (local) node.url = resolve(local.target, local.suffix);
    }
  });
  return { title, body: markdown.stringify(tree) };
}
