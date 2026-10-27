"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ dotName }: { readonly dotName: string }) {
  const path = usePathname();
  const links = [
    { href: "/", label: dotName },
    { href: "/activity", label: "Activity" },
    { href: "/rules", label: "Rules" },
    { href: "/apps", label: "Apps" },
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
