import type { MDXComponents } from "mdx/types";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { LiveParams } from "./LiveParams";
import { Contracts } from "./Contracts";
import { PayoutDemo } from "./PayoutDemo";
import { RatioDemo } from "./RatioDemo";
import { DocsRoutes } from "./DocsHome";
import * as diagrams from "./diagrams";

/** Everything an MDX page in content/docs can use without importing it (see content/AUTHORING.md). */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    Step,
    Steps,
    Tab,
    Tabs,
    LiveParams,
    Contracts,
    PayoutDemo,
    RatioDemo,
    DocsRoutes,
    ...diagrams,
    ...components,
  };
}
