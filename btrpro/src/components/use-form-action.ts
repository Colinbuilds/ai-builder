"use client";

import { useActionState, startTransition, type FormEvent } from "react";

// Like useActionState, but submits via onSubmit so React doesn't reset the form afterward.
// A reset after a rejected submit would snap selects back to their first option and wipe what
// the user typed (e.g. the stage picker jumping to "Lead" and a retry moving the job there).
export function useFormAction<S>(action: (state: Awaited<S>, form: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(form));
  };
  return [state, onSubmit, pending] as const;
}
