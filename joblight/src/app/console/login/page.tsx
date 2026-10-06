import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Operator sign-in", robots: { index: false } };

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <Logo className="text-lg" />
      <div>
        <h1 className="text-2xl font-bold">Operator console</h1>
        <p className="text-sm text-muted">Sign in to manage Joblight buildouts and leads.</p>
      </div>
      <LoginForm />
    </div>
  );
}
