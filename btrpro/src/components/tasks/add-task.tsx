"use client";

import { useFormAction } from "@/components/use-form-action";
import { addTaskAction } from "@/app/task-actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function AddTask({
  projectId,
  users,
  meId,
  jobs,
}: {
  projectId?: string;
  users: { id: string; name: string }[];
  meId: string;
  jobs?: { id: string; name: string }[];
}) {
  const [state, action, pending] = useFormAction(addTaskAction, null, {
    resetOnOk: true,
  });
  return (
    <form onSubmit={action} className="flex flex-col gap-1">
      {projectId && <input type="hidden" name="projectId" value={projectId} />}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="title"
          placeholder="Add a task…"
          className="h-8 min-w-60 flex-1"
          required
        />
        {jobs && (
          <Select name="projectId" defaultValue="" className="h-8 max-w-56">
            <option value="">No job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        )}
        <Input type="date" name="dueDate" className="h-8 w-40" />
        <Select name="assigneeId" defaultValue={meId} className="h-8">
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.id === meId ? "Me" : u.name}
            </option>
          ))}
          <option value="none">Nobody yet</option>
        </Select>
        <Button size="sm" variant="outline" disabled={pending}>
          Add
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}
