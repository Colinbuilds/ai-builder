import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { setUserRole } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { NewUserForm } from "./new-user-form";

export default async function UsersPage() {
  const me = await requireUser(["ADMIN"]);
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <Table>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Email</TH>
            <TH>Role</TH>
          </TR>
        </THead>
        <TBody>
          {users.map((u) => (
            <TR key={u.id}>
              <TD>{u.name}</TD>
              <TD>{u.email}</TD>
              <TD>
                {u.id === me.id ? (
                  u.role.toLowerCase()
                ) : (
                  <form action={setUserRole} className="flex gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <Select name="role" defaultValue={u.role}>
                      <option value="ADMIN">Admin</option>
                      <option value="ESTIMATOR">Estimator</option>
                      <option value="VIEWER">Viewer</option>
                    </Select>
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
      <div className="max-w-md">
        <h2 className="mb-2 font-semibold">Add a user</h2>
        <NewUserForm />
      </div>
    </div>
  );
}
