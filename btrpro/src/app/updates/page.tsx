import { Megaphone, Pin } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { PostUpdate } from "@/components/shell/post-update";
import { deleteUpdateAction, pinUpdateAction } from "@/app/shell-actions";

export default async function UpdatesPage() {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const updates = await prisma.companyUpdate.findMany({
    include: { author: { select: { name: true } } },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-light">Company updates</h1>
        <p className="text-sm text-muted-foreground">News for the whole team. New posts show on the dashboard and in everyone&apos;s notifications.</p>
      </div>
      {admin && <PostUpdate />}
      {updates.length === 0 && <p className="text-sm text-muted-foreground">No updates yet.</p>}
      <ol className="flex flex-col divide-y">
        {updates.map((u) => (
          <li key={u.id} id={u.id} className="flex scroll-mt-28 gap-3 py-4">
            {u.pinned ? <Pin size={18} className="mt-1 shrink-0 text-btr-blue" /> : <Megaphone size={18} className="mt-1 shrink-0 text-btr-blue" />}
            <div className="min-w-0 flex-1">
              <h2 className="font-medium">{u.title}</h2>
              <p className="text-xs text-muted-foreground">
                {u.author.name} ·{" "}
                {u.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}
              </p>
              {u.body && (
                <div className="mt-1 text-sm">
                  <Markdown text={u.body} />
                </div>
              )}
            </div>
            {admin && (
              <div className="flex shrink-0 gap-1">
                <form action={pinUpdateAction}>
                  <input type="hidden" name="id" value={u.id} />
                  <Button variant="ghost" size="sm">
                    {u.pinned ? "Unpin" : "Pin"}
                  </Button>
                </form>
                <form action={deleteUpdateAction}>
                  <input type="hidden" name="id" value={u.id} />
                  <Button variant="ghost" size="sm">
                    Delete
                  </Button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
