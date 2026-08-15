import Nav from "@/components/Nav";
import { login } from "@/app/auth/actions";

export const metadata = {
  title: "Log In",
  description: "Log in to your Sirtio account.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-sm mx-auto px-6 py-20">
        <h1 className="font-[family-name:var(--font-title)] font-bold text-3xl text-parchment mb-8">
          Log In
        </h1>

        {params.error && (
          <p className="text-sm text-signal-no mb-6">{params.error}</p>
        )}

        <form action={login} className="space-y-4">
          <div>
            <label className="block text-xs text-muted mb-1.5" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full bg-surface border border-hairline rounded-md px-3 py-2 text-sm text-parchment focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full bg-surface border border-hairline rounded-md px-3 py-2 text-sm text-parchment focus:outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            className="w-full px-5 py-2.5 bg-accent text-ink font-medium rounded-md hover:opacity-90 transition-opacity"
          >
            Log In
          </button>
        </form>

        <p className="text-sm text-muted mt-6">
          Don't have an account?{" "}
          <a href="/signup" className="text-accent hover:underline">
            Sign up
          </a>
        </p>
      </section>
    </div>
  );
}
