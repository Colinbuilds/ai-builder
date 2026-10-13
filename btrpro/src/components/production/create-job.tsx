"use client";

import { useState } from "react";
import { FullSheet } from "./full-sheet";
import { HouseForm } from "./house-form";

/** "+ Create job": the house form in a full-screen panel, so the schedule keeps the page. */
export function CreateJob({ defaultOpen, ...form }: { defaultOpen?: boolean } & React.ComponentProps<typeof HouseForm>) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="h-8 rounded-md bg-btr-blue px-3 text-sm font-medium text-white hover:bg-btr-blue-dark">
        + Create job
      </button>
      <FullSheet open={open} onClose={() => setOpen(false)} title={<h2 className="text-lg font-semibold">Create job</h2>}>
        <HouseForm {...form} />
      </FullSheet>
    </>
  );
}
