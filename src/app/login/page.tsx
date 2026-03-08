import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import LoginForm from "./LoginForm";
import AdteLogo from "@/app/components/AdteLogo";

type LoginPageProps = {
  searchParams: Promise<{ from?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-adte-page px-4 py-12">
      <div className="animate-adte-in flex w-full max-w-sm flex-col items-center gap-8">
        <AdteLogo size="lg" showWordmark={false} showTagline={false} className="shrink-0" />
        <div className="w-full rounded-2xl border border-white/[0.08] bg-[var(--adte-card-bg)] p-8 shadow-2xl">
          <h1 className="mb-1 text-xl font-semibold text-white">Sign in</h1>
          <p className="mb-6 text-sm text-[var(--adte-text-muted)]">
            Enter your credentials to continue.
          </p>
          <LoginForm from={params.from} />
        </div>
      </div>
    </div>
  );
}
