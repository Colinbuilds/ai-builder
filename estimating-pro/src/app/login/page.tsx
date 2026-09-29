import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="text-2xl font-semibold">Estimating Pro</h1>
      <p className="mb-6 text-sm text-muted-foreground">BTR Contracting · sign in</p>
      <LoginForm />
    </div>
  );
}
