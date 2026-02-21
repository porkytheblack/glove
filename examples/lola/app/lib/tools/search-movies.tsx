import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { CHARCOAL, AMBER, CREAM, CREAM_MUTED, VOID } from "../theme";
import {
  searchMovies,
  posterUrl,
  movieYear,
  type TMDBMovie,
} from "../tmdb";

// ─── search_movies — poster grid of search results (pushAndForget) ──────────

interface PosterGridProps {
  movies: TMDBMovie[];
}

function RatingBadge({ score }: { score: number }) {
  return (
    <span
      style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: 11,
        fontWeight: 500,
        background: AMBER[400],
        color: VOID,
        padding: "3px 7px",
        lineHeight: 1.2,
        display: "inline-block",
      }}
    >
      {score.toFixed(1)}
    </span>
  );
}

function PosterCard({ movie }: { movie: TMDBMovie }) {
  const imgSrc = posterUrl(movie.poster_path, "w342");
  const year = movieYear(movie);

  return (
    <div
      style={{
        background: CHARCOAL[900],
        border: `1px solid ${CHARCOAL[700]}`,
        overflow: "hidden",
        flex: "0 0 auto",
        width: 160,
        minWidth: 160,
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
        transition: "transform 0.25s ease, box-shadow 0.25s ease",
        position: "relative",
      }}
    >
      {/* Rating badge overlaid on poster */}
      {movie.vote_average > 0 && (
        <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
          <RatingBadge score={movie.vote_average} />
        </div>
      )}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={movie.title}
          style={{
            width: "100%",
            height: 240,
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: 240,
            background: CHARCOAL[700],
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: CHARCOAL[500],
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
          }}
        >
          No Poster
        </div>
      )}
      <div style={{ padding: "10px 12px" }}>
        <h4
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 15,
            fontWeight: 400,
            color: CREAM,
            margin: 0,
            lineHeight: 1.25,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {movie.title}
        </h4>
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: CREAM_MUTED,
            marginTop: 4,
            display: "block",
            opacity: 0.7,
          }}
        >
          {year}
        </span>
      </div>
    </div>
  );
}

function SinglePosterCard({ movie }: { movie: TMDBMovie }) {
  const imgSrc = posterUrl(movie.poster_path, "w500");
  const year = movieYear(movie);

  return (
    <div
      style={{
        background: CHARCOAL[900],
        border: `1px solid ${CHARCOAL[700]}`,
        overflow: "hidden",
        maxWidth: 280,
        boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)",
        position: "relative",
      }}
    >
      {movie.vote_average > 0 && (
        <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
          <RatingBadge score={movie.vote_average} />
        </div>
      )}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={movie.title}
          style={{
            width: "100%",
            height: 400,
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: 400,
            background: CHARCOAL[700],
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: CHARCOAL[500],
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
          }}
        >
          No Poster
        </div>
      )}
      <div style={{ padding: "14px 16px" }}>
        <h4
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 22,
            fontWeight: 400,
            color: CREAM,
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {movie.title}
        </h4>
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 12,
            color: CREAM_MUTED,
            marginTop: 6,
            display: "block",
            opacity: 0.7,
          }}
        >
          {year}
        </span>
      </div>
    </div>
  );
}

function PosterGrid({ movies }: PosterGridProps) {
  if (movies.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: CREAM_MUTED,
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
          fontStyle: "italic",
          textAlign: "center",
        }}
      >
        No movies found.
      </div>
    );
  }

  if (movies.length === 1) {
    return <SinglePosterCard movie={movies[0]} />;
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        justifyContent: "center",
      }}
    >
      {movies.map((movie) => (
        <PosterCard key={movie.id} movie={movie} />
      ))}
    </div>
  );
}

export function createSearchMoviesTool() {
  return defineTool({
    name: "search_movies",
    description:
      "Search for movies by title. Returns a visual grid of poster cards and text results for narration. Use this when the user asks about a specific movie or wants to find movies by name.",
    inputSchema: z.object({
      query: z.string().describe("Search query for movies"),
      year: z.number().optional().describe("Filter by release year"),
      max_results: z.number().optional().default(4).describe("Max results to show (1-6)"),
    }),
    displayPropsSchema: z.object({
      movies: z.array(z.any()),
    }),
    async do(input, display) {
      const clampedMax = Math.max(1, Math.min(6, input.max_results ?? 4));
      const results = await searchMovies(input.query, input.year);
      const movies = results.slice(0, clampedMax);

      if (movies.length === 0) {
        return {
          status: "success" as const,
          data: `No movies found matching "${input.query}".`,
          renderData: { movies: [] },
        };
      }

      await display.pushAndForget({ movies });

      const summaryLines = movies.map(
        (m, i) =>
          `${i + 1}. ${m.title} (${movieYear(m)}) — Rating: ${m.vote_average.toFixed(1)}/10 [ID: ${m.id}]`,
      );

      return {
        status: "success" as const,
        data: `Found ${movies.length} result(s) for "${input.query}":\n${summaryLines.join("\n")}`,
        renderData: { movies },
      };
    },
    render({ props }) {
      return <PosterGrid movies={props.movies as TMDBMovie[]} />;
    },
    renderResult({ data }) {
      const result = data as PosterGridProps;
      return <PosterGrid movies={result.movies as TMDBMovie[]} />;
    },
  });
}
