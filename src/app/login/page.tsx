import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import LoginForm from "./LoginForm";
import { LogoMark } from "@/app/components/AdteLogo";

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
        <div className="flex w-full min-h-0 max-w-full flex-col items-center gap-4 text-center sm:gap-5">
          <div className="flex min-h-0 w-full max-w-full flex-row items-center justify-center gap-4 sm:gap-6">
            <LogoMark variant="login" size="lg" className="shrink-0" />
            <div className="flex flex-col items-center justify-center gap-0.5 sm:items-start">
              <p className="text-2xl font-bold tracking-[-0.02em] text-white">
                Adtex
              </p>
            </div>
          </div>
        </div>
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
