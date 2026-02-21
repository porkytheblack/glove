import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { CHARCOAL, AMBER, CREAM, CREAM_MUTED, CREAM_DIM, VOID } from "../theme";
import {
  getMovieDetails,
  posterUrl,
  movieYear,
  formatRuntime,
  genreNames,
  type TMDBMovie,
} from "../tmdb";

// ─── compare_movies — side-by-side comparison grid (pushAndForget) ──────────

interface ComparisonGridProps {
  movies: TMDBMovie[];
}

function ComparisonCard({ movie }: { movie: TMDBMovie }) {
  const imgSrc = posterUrl(movie.poster_path, "w185");
  const year = movieYear(movie);
  const runtime = formatRuntime(movie.runtime);
  const genres = genreNames(movie);

  return (
    <div
      style={{
        background: CHARCOAL[900],
        border: `1px solid ${CHARCOAL[700]}`,
        overflow: "hidden",
        flex: "1 1 0",
        minWidth: 140,
        maxWidth: 200,
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
        transition: "transform 0.25s ease, box-shadow 0.25s ease",
      }}
    >
      {/* Poster */}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={movie.title}
          style={{
            width: "100%",
            height: 200,
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: 200,
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

      <div
        style={{
          padding: 12,
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Title */}
        <h4
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 15,
            fontWeight: 400,
            color: CREAM,
            margin: "0 0 6px",
            lineHeight: 1.25,
          }}
        >
          {movie.title}
        </h4>

        {/* Year + Runtime */}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: CREAM_DIM,
            }}
          >
            {year}
          </span>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: CREAM_DIM,
            }}
          >
            {runtime}
          </span>
        </div>

        {/* Rating badge */}
        {movie.vote_average > 0 && (
          <div style={{ marginBottom: 8 }}>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 13,
                fontWeight: 500,
                background: AMBER[400],
                color: VOID,
                padding: "3px 7px",
                display: "inline-block",
              }}
            >
              {movie.vote_average.toFixed(1)}
            </span>
          </div>
        )}

        {/* Genres */}
        {genres.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
              marginTop: "auto",
            }}
          >
            {genres.slice(0, 3).map((g) => (
              <span
                key={g}
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 9,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: CREAM_MUTED,
                  border: `1px solid ${CHARCOAL[700]}`,
                  padding: "2px 6px",
                  display: "inline-block",
                }}
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ComparisonGrid({ movies }: ComparisonGridProps) {
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
        No movies to compare.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        marginTop: 12,
        overflowX: "auto",
        paddingBottom: 4,
      }}
    >
      {movies.map((movie) => (
        <ComparisonCard key={movie.id} movie={movie} />
      ))}
    </div>
  );
}

export function createCompareMoviesTool() {
  return defineTool({
    name: "compare_movies",
    description:
      "Compare 2 to 4 movies side by side, showing posters, ratings, genres, and runtime. Useful when the user is deciding between multiple movies.",
    inputSchema: z.object({
      movie_ids: z
        .array(z.number())
        .min(2)
        .max(4)
        .describe("2-4 TMDB movie IDs to compare"),
    }),
    displayPropsSchema: z.object({
      movies: z.array(z.any()),
    }),
    async do(input, display) {
      const movies = await Promise.all(
        input.movie_ids.map((id) => getMovieDetails(id)),
      );

      await display.pushAndForget({ movies });

      const lines = movies.map((m) => {
        const year = movieYear(m);
        const runtime = formatRuntime(m.runtime);
        const genres = genreNames(m).join(", ");
        return `- ${m.title} (${year}): ${m.vote_average.toFixed(1)}/10, ${runtime}, ${genres}`;
      });

      const titles = movies.map((m) => m.title).join(", ");

      return {
        status: "success" as const,
        data: `Comparing ${titles}:\n${lines.join("\n")}`,
        renderData: { movies },
      };
    },
    render({ props }) {
      return <ComparisonGrid movies={props.movies as TMDBMovie[]} />;
    },
    renderResult({ data }) {
      const result = data as ComparisonGridProps;
      return <ComparisonGrid movies={result.movies as TMDBMovie[]} />;
    },
  });
}
