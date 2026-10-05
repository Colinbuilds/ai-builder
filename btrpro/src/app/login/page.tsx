import { LoginForm } from "./login-form";
import { appName, companyName } from "@/lib/company-profile";

export default function LoginPage() {
  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="text-2xl font-semibold">{appName()}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{companyName()} · sign in</p>
      <LoginForm />
    </div>
  );
}
