import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { contentByPath, source } from "../../../lib/source";
import { getMDXComponents } from "../../../mdx-components";

type Props = { params: Promise<{ slug?: string[] }> };
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const content = contentByPath.get(page.path);
  if (!content) notFound();
  const Content = content.body;
  return (
    <DocsPage toc={content.toc} full={content.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Content components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
export function generateStaticParams() {
  return source.generateParams();
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  return {
    title: page?.data.title ?? "Not found",
    description: page?.data.description ?? "Wellspent documentation",
  };
}
