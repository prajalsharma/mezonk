import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/docs/source";

// Full-text search over the docs (Orama, built in memory from the page index).
export const { GET } = createFromSource(source, { language: "english" });
