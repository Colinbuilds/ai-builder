"use client";

import { useActionState } from "react";
import { login } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input name="email" type="email" placeholder="Email" autoComplete="username" required className="field" />
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" required className="field" />
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
      <button className="btn" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
