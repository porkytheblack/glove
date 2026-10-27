"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/bots", label: "Bots" },
  { href: "/groups", label: "Group chats" },
  { href: "/apps", label: "Apps" },
  { href: "/templates", label: "Templates" },
] as const;

/** `demo`: the demo connectors are on, so "Try it" shows too. */
export function Nav({ demo = false }: { readonly demo?: boolean }) {
  const path = usePathname();
  const links = demo ? [...LINKS, { href: "/demo", label: "Try it" }] : LINKS;
  return (
    <nav aria-label="Main" className="nav">
      {links.map((link) => (
        <Link key={link.href} href={link.href} aria-current={path === link.href || path.startsWith(`${link.href}/`) ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
