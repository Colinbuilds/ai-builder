import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ProjectForm } from "@/components/projects/project-form";
import { createProjectAction } from "../actions";

export default async function NewProjectPage() {
  const me = await requireUser(["ADMIN", "ESTIMATOR"]);
  const [companies, users] = await Promise.all([
    prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: { not: "VIEWER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">New job</h1>
        <p className="text-sm text-muted-foreground">
          Creating the job builds its missing-information checklist from the scopes you pick. Fill in what you know; the rest
          stays MISSING until a source is provided.
        </p>
      </div>
      <ProjectForm
        action={createProjectAction}
        values={{ estimatorId: me.id }}
        companies={companies}
        users={users}
        submitLabel="Create job"
      />
    </div>
  );
}
