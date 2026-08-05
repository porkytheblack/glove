import Link from "next/link";
import type { ReactNode } from "react";

export interface DocCard {
  href: string;
  title: string;
  kicker?: string;
  desc: ReactNode;
  badge?: string;
  packages?: string[];
}

/** A responsive grid of link cards — used by the docs index and package tour. */
export function DocCards({ cards }: { cards: DocCard[] }) {
  return (
    <div className="doc-cards">
      {cards.map((card) => (
        <Link key={card.href + card.title} href={card.href} className="doc-card">
          {card.kicker && <span className="doc-card-kicker">{card.kicker}</span>}
          <span className="doc-card-title">
            {card.title}
            {card.badge && (
              <span className={`docs-badge ${card.badge}`}>{card.badge}</span>
            )}
          </span>
          <p className="doc-card-desc">{card.desc}</p>
          {card.packages && card.packages.length > 0 && (
            <span className="doc-card-pkgs">
              {card.packages.map((p) => (
                <span key={p} className="doc-card-pkg">
                  {p}
                </span>
              ))}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
