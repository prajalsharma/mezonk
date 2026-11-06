import { createElement } from "react";
import { icons } from "lucide-react";
import { loader } from "fumadocs-core/source";
import { docs } from "@/.source";

/** The docs page tree and pages, built from content/docs. Frontmatter `icon` is a lucide-react icon name. */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  icon(name) {
    if (name && name in icons) return createElement(icons[name as keyof typeof icons]);
  },
});
