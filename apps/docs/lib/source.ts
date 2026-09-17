import { loader } from "fumadocs-core/source";
import { docs } from "../.source/server";
export const source = loader(docs.toFumadocsSource(), { baseUrl: "/docs" });
// Keep compiled content types from the collection; the loader owns routing and navigation.
export const contentByPath = new Map(
  docs.docs.map((doc) => [doc.info.path, doc]),
);
