import type { ToolConfig } from "glove-react";
import { createSearchMoviesTool } from "./search-movies";
import { createGetMovieDetailsTool } from "./get-movie-details";
import { createGetRatingsTool } from "./get-ratings";
import { createGetTrailerTool } from "./get-trailer";
import { createCompareMoviesTool } from "./compare-movies";
import { createGetRecommendationsTool } from "./get-recommendations";
import { createGetPersonTool } from "./get-person";
import { createGetStreamingTool } from "./get-streaming";
import { createRememberPreferenceTool } from "./remember-preference";

// ─── Tool factory — assembles all Lola movie companion tools ────────────────

export function createLolaTools(): ToolConfig[] {
  return [
    createSearchMoviesTool(),
    createGetMovieDetailsTool(),
    createGetRatingsTool(),
    createGetTrailerTool(),
    createCompareMoviesTool(),
    createGetRecommendationsTool(),
    createGetPersonTool(),
    createGetStreamingTool(),
    createRememberPreferenceTool(),
  ];
}
