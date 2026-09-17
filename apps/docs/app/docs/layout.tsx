import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { source } from "../../lib/source";
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{ title: "Wellspent / Docs" }}
      sidebar={{ defaultOpenLevel: 1 }}
      links={[
        { text: "Architecture", url: "/docs/architecture/system-design" },
        { text: "Current plan", url: "/docs/plan/current" },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
