import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateFilesOnly } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";
import { transformMarkdown } from "./content.mjs";

export const appRoot = fileURLToPath(new URL("..", import.meta.url));
export const repoRoot = resolve(appRoot, "../..");
const contentRoot = join(appRoot, ".content");
const assetsRoot = join(appRoot, "public/repository");
const primary = new Map([
  ["docs/WELLSPENT_PLAN.md", "plan/current"],
  [
    "docs/design/2026-09-17-wellspent-system-design.md",
    "architecture/system-design",
  ],
  ["docs/design/README.md", "architecture/index"],
  [
    "docs/design/2026-09-12-wellspent-local-first-architecture.md",
    "architecture/local-first",
  ],
  [
    "docs/design/2026-09-12-wellspent-security-design.md",
    "architecture/security",
  ],
  ["docs/design/2026-09-12-wellspent-research-roadmap.md", "plan/experiments"],
  ["docs/design/2026-09-12-wellspent-workflow-capture-plan.md", "plan/capture"],
  ["packages/api-client/README.md", "packages/api-client"],
  ["packages/api-contract/README.md", "packages/api-contract"],
  ["packages/session-domain/README.md", "packages/session-domain"],
  ["packages/liquid-ui/README.md", "packages/liquid-ui"],
  ["integrations/codex/README.md", "integrations/codex"],
  ["integrations/codex/local-README.md", "integrations/codex-local"],
  ["integrations/honcho/README.md", "integrations/honcho"],
  ["docs/work-log.md", "integrations/work-log"],
  ["docs/native-openapi.md", "packages/native-http"],
  ["README.md", "development/repository"],
  ["apps/macos/README.md", "development/macos"],
  ["apps/docs/README.md", "development/docs-site"],
]);

export const watchPaths = [
  "docs",
  "packages/api-client",
  "packages/api-contract",
  "integrations/codex",
  "integrations/honcho",
  "apps/macos/README.md",
  "README.md",
  "apps/docs/README.md",
].map((p) => join(repoRoot, p));

function collectDocs(dir) {
  return readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap(
    (item) => {
      const path = `${dir}/${item.name}`;
      return item.isDirectory()
        ? collectDocs(path)
        : item.name.endsWith(".md")
          ? [path]
          : [];
    },
  );
}
function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  if (
    !existsSync(path) ||
    readFileSync(path).compare(Buffer.from(contents)) !== 0
  )
    writeFileSync(path, contents);
}

export async function prepare() {
  const pages = new Map(primary);
  for (const path of collectDocs("docs")) {
    if (pages.has(path)) continue;
    const slug = path.startsWith("docs/design/")
      ? `architecture/archive/${path.slice("docs/design/".length).replace(/\.md$/, "")}`
      : `development/${path.slice("docs/".length).replace(/\.md$/, "")}`;
    pages.set(path, slug);
  }
  const generated = new Set();
  const assets = new Set();
  const referencedPaths = new Set();
  const missing = new Set();
  function output(slug, contents, extension = "md") {
    const path = join(contentRoot, `${slug}.${extension}`);
    write(path, contents);
    generated.add(path);
  }
  function asset(target) {
    const input = join(repoRoot, target);
    const actual = realpathSync(input);
    referencedPaths.add(actual);
    if (!actual.startsWith(`${repoRoot}/`))
      throw new Error(`Asset outside repository: ${target}`);
    // Only explicit documentation references become assets, never whole source directories.
    const extension = extname(target);
    const image = [".svg", ".png", ".jpg", ".webp"].includes(extension);
    const allowed =
      image ||
      [
        ".md",
        ".mmd",
        ".json",
        ".ts",
        ".tsx",
        ".mjs",
        ".swift",
        ".rs",
        ".toml",
        ".sh",
        ".sql",
      ].includes(extension) ||
      ["LICENSE", "COMMERCIAL-LICENSE.md", "CONTRIBUTING.md"].includes(target);
    if (!allowed) throw new Error(`Unsupported documentation asset: ${target}`);
    const served = image ? target : `${target}.txt`;
    const destination = join(assetsRoot, served);
    write(destination, readFileSync(input));
    assets.add(destination);
    return `/repository/${served}`;
  }
  function resolveLink(target, suffix) {
    const normalized = target.replace(/\.html$/, ".md");
    const slug = pages.get(normalized);
    if (slug) {
      const url = `/docs/${slug.replace(/\/index$/, "")}${suffix}`;
      return url;
    }
    if (existsSync(join(repoRoot, target))) {
      if (statSync(join(repoRoot, target)).isDirectory()) {
        for (const name of ["README.md", "index.md"]) {
          if (existsSync(join(repoRoot, target, name)))
            return resolveLink(`${target}/${name}`, suffix);
        }
      } else return asset(target) + suffix;
    }
    missing.add(target);
    return "/docs/development/unavailable-sources";
  }
  for (const [path, slug] of pages) {
    const { title, body } = transformMarkdown(
      readFileSync(join(repoRoot, path), "utf8"),
      path,
      resolveLink,
    );
    const raw = asset(path);
    output(
      slug,
      `---\ntitle: ${JSON.stringify(title)}\n${slug === "architecture/system-design" ? "full: true\n" : ""}description: ${JSON.stringify(`Source: ${path}`)}\n---\n\n[View Markdown source](${raw})\n\n${body}`,
    );
  }
  const sections = {
    architecture: "Architecture",
    plan: "Plan and decisions",
    packages: "Packages",
    integrations: "Integrations",
    development: "Development",
  };
  for (const [slug, title] of Object.entries(sections))
    output(`${slug}/meta`, JSON.stringify({ title }), "json");
  output(
    "meta",
    JSON.stringify({
      title: "Wellspent",
      pages: [
        "index",
        "architecture",
        "plan",
        "packages",
        "api",
        "integrations",
        "development",
      ],
    }),
    "json",
  );
  output(
    "architecture/meta",
    JSON.stringify({
      title: "Architecture",
      pages: ["system-design", "index", "local-first", "security", "archive"],
    }),
    "json",
  );
  output(
    "plan/meta",
    JSON.stringify({
      title: "Plan and decisions",
      pages: ["current", "experiments", "capture"],
    }),
    "json",
  );
  output(
    "architecture/archive/meta",
    JSON.stringify({ title: "Design history and evidence" }),
    "json",
  );
  output(
    "index",
    `---\ntitle: Wellspent documentation\ndescription: Understand the system, inspect the evidence, and choose the next piece of work.\n---\n\n## Start here\n\n- [Visual system design](/docs/architecture/system-design) — seven diagrams covering today's system, the encrypted target, Rust, evidence, and build order.\n- [Current plan](/docs/plan/current) — priorities, status, and the next handoff.\n- [Architecture index](/docs/architecture) — which design owns which decision.\n- [Research experiments](/docs/plan/experiments) — unresolved questions and the proofs that settle them.\n\n## Build with Wellspent\n\n- [API client](/docs/packages/api-client) — typed requests, authentication, query helpers, and work-log transport.\n- [API contract](/docs/packages/api-contract) — schema ownership and change workflow.\n- [HTTP reference](/docs/api) — generated Focus and work-log endpoints.\n- [Codex capture](/docs/integrations/codex-local), [CLI and MCP work log](/docs/integrations/work-log), and [Honcho](/docs/integrations/honcho).\n- [Development setup](/docs/development/repository) and [verification](/docs/development/verification).\n\n## Reading the evidence\n\nThe current plan owns priority. Dated designs describe intent; acceptance documents record what was actually checked. Historical pages remain available with their original dates and limitations.\n\nContent is built from the Markdown beside the owning code. Edit the source path displayed on each page. This is a local/internal documentation site; publication and access control are separate work.\n`,
  );
  output(
    "development/unavailable-sources",
    `---\ntitle: Unavailable historical sources\ndescription: References retained from existing documents whose targets are absent in this checkout.\n---\n\n${
      missing.size
        ? [...missing]
            .sort()
            .map((p) => `- \`${p}\``)
            .join("\n")
        : "All local source targets exist."
    }\n`,
  );
  // Remove pages/assets no longer present in the allowlisted source graph.
  function prune(dir, keep) {
    if (!existsSync(dir)) return;
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) prune(path, keep);
      else if (!keep.has(path)) rmSync(path);
    }
  }
  // The API output is generated below, so prune it together with the other derived files.
  const openapi = createOpenAPI({
    input: {
      native: join(repoRoot, "packages/api-contract/openapi.native.json"),
    },
  });
  const apiFiles = await generateFilesOnly({
    input: openapi,
    includeDescription: true,
    index: {
      items: [
        {
          path: "index",
          title: "HTTP API reference",
          description:
            "Generated Focus and work-log contract. The shared stopwatch WebSocket and other APIs are outside this specification.",
        },
      ],
      url: { baseUrl: "/docs/api", contentDir: "." },
    },
  });
  for (const file of apiFiles)
    output(`api/${file.path.replace(/\.mdx$/, "")}`, file.content, "mdx");
  output("api/meta", JSON.stringify({ title: "HTTP reference" }), "json");

  prune(contentRoot, generated);
  prune(assetsRoot, assets);
  console.log(
    `Docs: ${pages.size} source pages, ${assets.size} referenced assets, ${missing.size} unavailable historical sources.`,
  );
  if (missing.size) console.warn([...missing].sort().join("\n"));
  return [...referencedPaths];
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await prepare();
