import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setUserOwner, setUserRole, setUserTexts } from "@/app/actions";
import { smsConfigured } from "@/lib/sms";
import { ROLE_LABEL, ROLES } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { NewUserForm } from "./new-user-form";

export default async function UsersPage() {
  const me = await requireUser(["ADMIN"]);
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
  // owners see the Audit tools; only an owner can grant it (or any admin before there is one)
  const canOwn = me.isOwner || !users.some((u) => u.isOwner);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <Table>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Email</TH>
            <TH>Role</TH>
            <TH>Owner</TH>
            <TH>Crew texts</TH>
          </TR>
        </THead>
        <TBody>
          {users.map((u) => (
            <TR key={u.id}>
              <TD>{u.name}</TD>
              <TD>{u.email}</TD>
              <TD>
                {u.id === me.id ? (
                  ROLE_LABEL[u.role]
                ) : (
                  <form action={setUserRole} className="flex gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <Select name="role" defaultValue={u.role}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                    <Button variant="outline" size="sm">
                      Save
                    </Button>
                  </form>
                )}
              </TD>
              <TD>
                {canOwn ? (
                  <form action={setUserOwner} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <input type="checkbox" name="isOwner" defaultChecked={u.isOwner} aria-label={`Owner: ${u.name}`} disabled={u.id === me.id && u.isOwner} />
                    {!(u.id === me.id && u.isOwner) && (
                      <Button variant="outline" size="sm">
                        Save
                      </Button>
                    )}
                  </form>
                ) : u.isOwner ? (
                  "Owner"
                ) : (
                  ""
                )}
              </TD>
              <TD>
                {u.role !== "VIEWER" && (
                  <form action={setUserTexts} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <input name="phone" type="tel" defaultValue={u.phone?.replace(/^\+1/, "") ?? ""} placeholder="Cell" aria-label={`Cell: ${u.name}`} className="h-8 w-32 rounded-md border border-input bg-background px-2 text-sm" />
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name="crewTexts" defaultChecked={u.crewTexts} /> texts
                    </label>
                    <Button variant="outline" size="sm">
                      Save
                    </Button>
                  </form>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <p className="text-sm text-muted-foreground">
        Crew texts go to project managers when a crew starts on site, finishes, or reports a problem. Never to customers.
        {!smsConfigured() && " Texting isn't set up yet (needs the Twilio keys) — alerts still show on the job's activity."}
      </p>
      <div className="max-w-md">
        <h2 className="mb-2 font-semibold">Add a user</h2>
        <NewUserForm />
      </div>
    </div>
  );
}
