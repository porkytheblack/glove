import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { CHARCOAL, AMBER, CREAM, CREAM_MUTED, CREAM_DIM, VOID } from "../theme";
import {
  getMovieRecommendations,
  discoverMovies,
  posterUrl,
  movieYear,
  moodToGenreIds,
  type TMDBMovie,
} from "../tmdb";

// ─── get_recommendations — numbered vertical list (pushAndForget) ───────────

interface RecommendationListProps {
  movies: TMDBMovie[];
}

function RecommendationRow({ movie, index }: { movie: TMDBMovie; index: number }) {
  const imgSrc = posterUrl(movie.poster_path, "w92");
  const year = movieYear(movie);
  const snippet =
    movie.overview.length > 120
      ? movie.overview.substring(0, 120) + "..."
      : movie.overview;

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "10px 0",
        borderBottom: `1px solid ${CHARCOAL[700]}`,
        alignItems: "flex-start",
      }}
    >
      {/* Number */}
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 14,
          color: AMBER[400],
          fontWeight: 500,
          flexShrink: 0,
          width: 20,
          textAlign: "right",
          lineHeight: "48px",
        }}
      >
        {index + 1}
      </span>

      {/* Poster thumbnail */}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={movie.title}
          style={{
            width: 48,
            height: 72,
            objectFit: "cover",
            flexShrink: 0,
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: 48,
            height: 72,
            background: CHARCOAL[700],
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: CHARCOAL[500],
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 8,
          }}
        >
          N/A
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <h4
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 15,
              fontWeight: 400,
              color: CREAM,
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            {movie.title}
          </h4>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: CREAM_DIM,
              flexShrink: 0,
            }}
          >
            {year}
          </span>
          {movie.vote_average > 0 && (
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                fontWeight: 500,
                background: AMBER[400],
                color: VOID,
                padding: "2px 6px",
                flexShrink: 0,
              }}
            >
              {movie.vote_average.toFixed(1)}
            </span>
          )}
        </div>
        {snippet && (
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 11,
              lineHeight: 1.5,
              color: CREAM_MUTED,
              margin: "4px 0 0",
            }}
          >
            {snippet}
          </p>
        )}
      </div>
    </div>
  );
}

function RecommendationList({ movies }: RecommendationListProps) {
  if (movies.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          color: CREAM_MUTED,
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
          fontStyle: "italic",
        }}
      >
        No recommendations found.
      </div>
    );
  }

  return (
    <div
      style={{
        background: CHARCOAL[900],
        border: `1px solid ${CHARCOAL[700]}`,
        padding: "4px 16px",
        maxWidth: 500,
        width: "100%",
        boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)",
      }}
    >
      {movies.map((movie, i) => (
        <RecommendationRow key={movie.id} movie={movie} index={i} />
      ))}
    </div>
  );
}

export function createGetRecommendationsTool() {
  return defineTool({
    name: "get_recommendations",
    description:
      "Get movie recommendations based on a seed movie or a mood/vibe description. If given a movie_id, finds similar movies. If given a mood string, discovers movies matching that vibe. Returns a numbered list for easy verbal reference.",
    inputSchema: z.object({
      movie_id: z.number().optional().describe("Seed movie ID for similar recommendations"),
      mood: z.string().optional().describe("Mood/vibe for discovery (e.g. 'feel-good comedy')"),
      max_results: z.number().optional().default(5).describe("Number of recommendations"),
    }),
    displayPropsSchema: z.object({
      movies: z.array(z.any()),
    }),
    async do(input, display) {
      const clampedMax = Math.max(1, Math.min(10, input.max_results ?? 5));
      let results: TMDBMovie[];

      if (input.movie_id) {
        results = await getMovieRecommendations(input.movie_id);
      } else if (input.mood) {
        const genreIds = moodToGenreIds(input.mood);
        results = await discoverMovies({
          genreIds: genreIds.length > 0 ? genreIds : undefined,
          minRating: 6,
        });
      } else {
        // Fallback: popular movies
        results = await discoverMovies({ minRating: 7 });
      }

      const movies = results.slice(0, clampedMax);

      if (movies.length === 0) {
        return {
          status: "success" as const,
          data: "No recommendations found. Try a different mood or movie.",
          renderData: { movies: [] },
        };
      }

      await display.pushAndForget({ movies });

      const lines = movies.map((m, i) => {
        const year = movieYear(m);
        const snippet =
          m.overview.length > 100
            ? m.overview.substring(0, 100) + "..."
            : m.overview;
        return `${i + 1}. ${m.title} (${year}) — ${snippet}`;
      });

      return {
        status: "success" as const,
        data: `Here are ${movies.length} recommendations:\n${lines.join("\n")}`,
        renderData: { movies },
      };
    },
    render({ props }) {
      return <RecommendationList movies={props.movies as TMDBMovie[]} />;
    },
    renderResult({ data }) {
      const result = data as RecommendationListProps;
      return <RecommendationList movies={result.movies as TMDBMovie[]} />;
    },
  });
}
