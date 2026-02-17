"use client";

import { useState, useMemo } from "react";
import { getAllEntries } from "@/registry/_catalog";
import { ToolCard } from "./tool-card";
import { CategoryTabs } from "./category-tabs";

const ALL_CATEGORY = "all";

export function ToolsGrid() {
  const tools = useMemo(() => getAllEntries(), []);
  const [active, setActive] = useState(ALL_CATEGORY);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(tools.map((t) => t.category)));
    return [ALL_CATEGORY, ...cats];
  }, [tools]);

  const filtered = useMemo(() => {
    if (active === ALL_CATEGORY) return tools;
    return tools.filter((t) => t.category === active);
  }, [tools, active]);

  return (
    <div className="registry-container">
      <CategoryTabs
        categories={categories}
        active={active}
        onChange={setActive}
      />
      <div className="tool-grid">
        {filtered.map((tool) => (
          <ToolCard
            key={tool.slug}
            slug={tool.slug}
            name={tool.name}
            category={tool.category}
            pattern={tool.pattern}
            description={tool.description}
          />
        ))}
      </div>
    </div>
  );
}
