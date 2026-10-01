"use client";

import { useActionState } from "react";
import { createUser } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export function NewUserForm() {
  const [error, action, pending] = useActionState(createUser, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <Input name="name" placeholder="Name" required />
      <Input name="email" type="email" placeholder="Email" required />
      <Input name="password" type="password" placeholder="Temporary password (10+ characters)" required />
      <Select name="role" defaultValue="ESTIMATOR">
        <option value="ESTIMATOR">Sales / Estimator</option>
        <option value="OFFICE">Office</option>
        <option value="PURCHASING">Purchasing</option>
        <option value="VIEWER">Viewer</option>
        <option value="ADMIN">Admin</option>
      </Select>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending}>{pending ? "Adding…" : "Add user"}</Button>
    </form>
  );
}
