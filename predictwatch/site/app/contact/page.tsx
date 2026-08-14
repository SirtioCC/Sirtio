import Nav from "@/components/Nav";

export const metadata = {
  title: "Contact",
  description: "Get in touch with the Sirtio team.",
};

const CONTACT_EMAIL = "sirtio.enterprise@gmail.com";

export default function ContactPage() {
  return (
    <div className="min-h-screen">
      <Nav />
      <section className="max-w-3xl mx-auto px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-accent mb-6">
          Contact
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl leading-tight text-parchment mb-8">
          Talk to the team behind the numbers
        </h1>
        <p className="text-lg text-muted leading-relaxed">
          Sirtio is built and run by a working analytics professional --
          not a faceless product team. Every metric on this site, from
          Sirtio Score down to the realized-PnL ledger behind it, is
          designed, tested, and maintained with the same rigor you'd
          expect from institutional-grade market analysis. If you have
          a question, a data request, a partnership idea, or you've
          spotted something that doesn't look right, we want to hear
          about it directly.
        </p>

        <div className="mt-16 border border-hairline rounded-lg p-8">
          <p className="font-mono text-xs uppercase tracking-wide text-muted mb-3">
            Email us directly
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-[family-name:var(--font-display)] text-2xl md:text-3xl text-accent hover:underline break-all"
          >
            {CONTACT_EMAIL}
          </a>
          <p className="text-sm text-muted mt-4 leading-relaxed">
            Whether it's enterprise data access, a methodology
            question, press, or general feedback -- reach out and a
            real person will get back to you.
          </p>
        </div>

        <div className="mt-16 grid md:grid-cols-3 gap-6">
          <div className="border border-hairline rounded-lg p-6">
            <p className="text-sm text-parchment font-medium mb-2">
              Enterprise &amp; data access
            </p>
            <p className="text-sm text-muted leading-relaxed">
              Looking for deeper access to Sirtio's trader analytics,
              scoring history, or raw datasets? Let's talk.
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-6">
            <p className="text-sm text-parchment font-medium mb-2">
              Methodology questions
            </p>
            <p className="text-sm text-muted leading-relaxed">
              Curious how Sirtio Score, market coverage, or accuracy
              tracking actually works under the hood? We're glad to
              walk through it.
            </p>
          </div>
          <div className="border border-hairline rounded-lg p-6">
            <p className="text-sm text-parchment font-medium mb-2">
              Report an issue
            </p>
            <p className="text-sm text-muted leading-relaxed">
              Spotted a bad link, an off number, or something that
              doesn't add up? Flag it and we'll dig in.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
