import type { Metadata } from "next";
import { ProjectForm } from "@/features/governance/ProjectForm";

export const metadata: Metadata = { title: "Register a project" };

export default function NewProjectPage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-3">
        <h1 className="display text-5xl md:text-6xl">Register a project</h1>
        <p className="text-ink-2">
          Claim to represent a project so markets you suggest about it carry the right disclosure. A curator checks your proof before the claim counts.
        </p>
      </div>
      <ProjectForm />
    </div>
  );
}
