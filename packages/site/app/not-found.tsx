import Link from "next/link";

export const metadata = {
  title: "Page not found",
  description: "This page does not exist. Search the Glove and Foundry docs or start from a guide.",
};

const destinations = [
  { href: "/foundry/docs", title: "Foundry handbook", desc: "Build, run and inspect complete agent systems." },
  { href: "/foundry/docs/tutorial", title: "Foundry tutorial", desc: "Your first agent system, step by step." },
  { href: "/docs", title: "Glove docs", desc: "The runtime and every capability package." },
  { href: "/docs/packages", title: "All packages", desc: "What each package is for, with the smallest snippet." },
];

export default function NotFound() {
  return (
    <main className="not-found">
      <span className="section-label">404</span>
      <h1>This page isn&apos;t here.</h1>
      <p>
        It may have moved during a docs reorganisation. Press <kbd className="search-kbd">⌘K</kbd> to
        search every page, or start from one of these.
      </p>
      <div className="doc-cards">
        {destinations.map((item) => (
          <Link key={item.href} href={item.href} className="doc-card">
            <span className="doc-card-title">{item.title}</span>
            <p className="doc-card-desc">{item.desc}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
