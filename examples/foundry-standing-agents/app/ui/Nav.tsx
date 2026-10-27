"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The main links, and Try it when the demo connectors are on. */
export function Nav({ dotName, demo = false }: { readonly dotName: string; readonly demo?: boolean }) {
  const path = usePathname();
  const links = [
    { href: "/", label: dotName },
    { href: "/activity", label: "Activity" },
    { href: "/rules", label: "Rules" },
    { href: "/apps", label: "Apps" },
    ...(demo ? [{ href: "/demo", label: "Try it" }] : []),
  ];
  return (
    <nav aria-label="Main" className="nav">
      {links.map((link) => (
        <Link key={link.href} href={link.href} aria-current={path === link.href ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
