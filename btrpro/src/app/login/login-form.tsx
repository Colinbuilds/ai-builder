"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Label htmlFor="email">Email</Label>
      <Input id="email" name="email" type="email" autoComplete="username" defaultValue={state?.email} key={state?.email} required />
      <Label htmlFor="password">Password</Label>
      <Input id="password" name="password" type="password" autoComplete="current-password" required />
      {state && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
