import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setUserOwner, setUserRole } from "@/app/actions";
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
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="max-w-md">
        <h2 className="mb-2 font-semibold">Add a user</h2>
        <NewUserForm />
      </div>
    </div>
  );
}
