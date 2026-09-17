import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalLink, transformMarkdown } from "./content.mjs";

test("relative links resolve against their canonical source, preserving anchors", () => {
  assert.deepEqual(
    resolveLocalLink(
      "docs/design/plan.md",
      "../WELLSPENT_PLAN.md#ordered-work",
    ),
    { target: "docs/WELLSPENT_PLAN.md", suffix: "#ordered-work" },
  );
  assert.equal(
    resolveLocalLink("docs/plan.md", "https://example.com/page"),
    null,
  );
  assert.equal(resolveLocalLink("docs/plan.md", "#section"), null);
});

test("links cannot escape the repository or depend on absolute workstation paths", () => {
  assert.throws(
    () => resolveLocalLink("docs/plan.md", "../../private.md"),
    /leaves repository/,
  );
  assert.throws(
    () => resolveLocalLink("docs/plan.md", "/Users/name/private.md"),
    /Absolute local/,
  );
});

test("Markdown migration rewrites images and reference links without altering code examples", () => {
  const input =
    "# Title\n\n![Diagram](diagrams/state.svg)\n\n[Plan][plan]\n\n[plan]: ../WELLSPENT_PLAN.md#next\n\n```md\n[example](keep-me.md)\n```\n";
  const result = transformMarkdown(
    input,
    "docs/design/plan.md",
    (target, suffix) => `/resolved/${target}${suffix}`,
  );
  assert.equal(result.title, "Title");
  assert.match(result.body, /\/resolved\/docs\/design\/diagrams\/state.svg/);
  assert.match(result.body, /\/resolved\/docs\/WELLSPENT_PLAN.md#next/);
  assert.match(result.body, /\[example\]\(keep-me.md\)/);
});

test("source frontmatter remains metadata rather than becoming a duplicate document heading", () => {
  const result = transformMarkdown(
    "---\nname: guide\n---\n\n# Native guide\n\nBody",
    "docs/guide.md",
    () => "unused",
  );
  assert.equal(result.title, "Native guide");
  assert.equal(result.body.trim(), "Body");
});
