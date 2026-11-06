import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from "fumadocs-mdx/config";

// Docs content lives in content/docs (MDX). `fumadocs-mdx` compiles it into .source/ at build and on `pnpm install`.
export const docs = defineDocs({
  dir: "content/docs",
  docs: { schema: frontmatterSchema },
  meta: { schema: metaSchema },
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: { light: "github-light", dark: "github-dark-dimmed" },
    },
  },
});
