import defaultComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { OpenAPIPage } from "./components/api-page";
import { Diagram } from "./components/diagram";
export function getMDXComponents(): MDXComponents {
  return { ...defaultComponents, img: Diagram, OpenAPIPage };
}
