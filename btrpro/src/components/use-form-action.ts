"use client";

import {
  useActionState,
  startTransition,
  useEffect,
  useRef,
  type FormEvent,
} from "react";

// Like useActionState, but submits via onSubmit so React doesn't reset the form afterward.
// A reset after a rejected submit would snap selects back to their first option and wipe what
// the user typed (e.g. the stage picker jumping to "Lead" and a retry moving the job there).
// Pass { resetOnOk: true } for "add another" forms that should clear after a successful save.
export function useFormAction<S>(
  action: (state: Awaited<S>, form: FormData) => S | Promise<S>,
  initial: Awaited<S>,
  opts: { resetOnOk?: boolean } = {},
) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const form = useRef<HTMLFormElement | null>(null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    form.current = e.currentTarget;
    const data = new FormData(
      e.currentTarget,
      (e.nativeEvent as SubmitEvent).submitter,
    );
    startTransition(() => dispatch(data));
  };
  useEffect(() => {
    if (
      opts.resetOnOk &&
      state &&
      typeof state === "object" &&
      "ok" in state &&
      state.ok
    )
      form.current?.reset();
  }, [state, opts.resetOnOk]);
  return [state, onSubmit, pending] as const;
}
