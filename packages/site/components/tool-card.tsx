import Link from "next/link";
import type { ToolCategory, ToolPattern } from "@/registry/_meta";

interface ToolCardProps {
  slug: string;
  name: string;
  category: ToolCategory;
  pattern: ToolPattern;
  description: string;
}

export function ToolCard({
  slug,
  name,
  category,
  pattern,
  description,
}: ToolCardProps) {
  return (
    <Link href={`/tools/${slug}`} className="tool-card">
      <div className="tool-card-header">
        <span className="tool-card-name">{name}</span>
        <span className="tool-card-category">{category}</span>
      </div>
      <p className="tool-card-desc">{description}</p>
      <span className="tool-card-pattern">{pattern}</span>
    </Link>
  );
}
