import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { CHARCOAL, AMBER, CREAM, CREAM_MUTED, CREAM_DIM, VOID } from "../theme";
import {
  getMovieDetails,
  backdropUrl,
  movieYear,
  formatRuntime,
  getDirector,
  getTopCast,
  genreNames,
  getProviders,
  type TMDBMovie,
  type TMDBCastMember,
} from "../tmdb";

// ─── get_movie_details — full info card (pushAndForget) ─────────────────────

interface MovieInfoCardProps {
  movie: TMDBMovie;
}

function GenreTag({ name }: { name: string }) {
  return (
    <span
      style={{
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 10,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: AMBER[200],
        border: `1px solid ${CHARCOAL[600]}`,
        padding: "4px 10px",
        display: "inline-block",
      }}
    >
      {name}
    </span>
  );
}

function CastRow({ member }: { member: TMDBCastMember }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "5px 0",
      }}
    >
      <span
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 12,
          color: CREAM,
        }}
      >
        {member.name}
      </span>
      <span
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          color: CREAM_DIM,
          fontStyle: "italic",
          textAlign: "right",
          marginLeft: 12,
          flexShrink: 0,
        }}
      >
        {member.character}
      </span>
    </div>
  );
}

function MovieInfoCard({ movie }: MovieInfoCardProps) {
  const backdrop = backdropUrl(movie.backdrop_path, "w780");
  const year = movieYear(movie);
  const runtime = formatRuntime(movie.runtime);
  const director = getDirector(movie);
  const cast = getTopCast(movie, 5);
  const genres = genreNames(movie);
  const providers = getProviders(movie);
  const streamingServices = providers?.flatrate ?? [];

  return (
    <div
      style={{
        background: CHARCOAL[900],
        border: `1px solid ${CHARCOAL[700]}`,
        overflow: "hidden",
        maxWidth: 500,
        width: "100%",
        boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Backdrop with gradient overlay */}
      {backdrop ? (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: 200,
            overflow: "hidden",
          }}
        >
          <img
            src={backdrop}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "100%",
              background: `linear-gradient(to top, ${CHARCOAL[900]} 0%, transparent 70%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 14,
              left: 16,
              right: 16,
            }}
          >
            <h3
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 28,
                fontWeight: 400,
                color: CREAM,
                margin: 0,
                lineHeight: 1.15,
                textShadow: `0 2px 12px ${VOID}`,
              }}
            >
              {movie.title}
            </h3>
            {movie.tagline && (
              <p
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12,
                  color: CREAM_MUTED,
                  fontStyle: "italic",
                  margin: "4px 0 0",
                }}
              >
                {movie.tagline}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div style={{ padding: "20px 16px 0" }}>
          <h3
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 26,
              fontWeight: 400,
              color: CREAM,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {movie.title}
          </h3>
          {movie.tagline && (
            <p
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                color: CREAM_MUTED,
                fontStyle: "italic",
                margin: "4px 0 0",
              }}
            >
              {movie.tagline}
            </p>
          )}
        </div>
      )}

      <div style={{ padding: "16px 20px 20px" }}>
        {/* Genres */}
        {genres.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {genres.map((g) => (
              <GenreTag key={g} name={g} />
            ))}
          </div>
        )}

        {/* Year / Runtime / Rating row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 12,
              color: CREAM_DIM,
            }}
          >
            {year}
          </span>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 12,
              color: CREAM_DIM,
            }}
          >
            {runtime}
          </span>
          {movie.vote_average > 0 && (
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                fontWeight: 500,
                background: AMBER[400],
                color: VOID,
                padding: "3px 7px",
              }}
            >
              {movie.vote_average.toFixed(1)}
            </span>
          )}
        </div>

        {/* Overview */}
        {movie.overview && (
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              lineHeight: 1.7,
              color: CREAM,
              margin: "0 0 16px",
              opacity: 0.9,
            }}
          >
            {movie.overview}
          </p>
        )}

        {/* Director */}
        {director !== "Unknown" && (
          <div
            style={{
              padding: "10px 0",
              borderTop: `1px solid ${CHARCOAL[700]}`,
            }}
          >
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: CREAM_DIM,
                display: "block",
                marginBottom: 4,
              }}
            >
              Director
            </span>
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                color: CREAM,
              }}
            >
              {director}
            </span>
          </div>
        )}

        {/* Cast */}
        {cast.length > 0 && (
          <div
            style={{
              padding: "10px 0",
              borderTop: `1px solid ${CHARCOAL[700]}`,
            }}
          >
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: CREAM_DIM,
                display: "block",
                marginBottom: 6,
              }}
            >
              Cast
            </span>
            {cast.map((member) => (
              <CastRow key={member.id} member={member} />
            ))}
          </div>
        )}

        {/* Streaming */}
        {streamingServices.length > 0 && (
          <div
            style={{
              padding: "10px 0",
              borderTop: `1px solid ${CHARCOAL[700]}`,
            }}
          >
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: CREAM_DIM,
                display: "block",
                marginBottom: 6,
              }}
            >
              Streaming On
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {streamingServices.map((p) => (
                <span
                  key={p.provider_id}
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 11,
                    color: AMBER[200],
                    background: CHARCOAL[700],
                    padding: "4px 10px",
                    display: "inline-block",
                  }}
                >
                  {p.provider_name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function createGetMovieDetailsTool() {
  return defineTool({
    name: "get_movie_details",
    description:
      "Get comprehensive details about a specific movie including overview, cast, director, runtime, rating, genres, and streaming availability. Shows a rich visual card.",
    inputSchema: z.object({
      movie_id: z.number().describe("TMDB movie ID"),
    }),
    displayPropsSchema: z.object({
      movie: z.any(),
    }),
    async do(input, display) {
      const movie = await getMovieDetails(input.movie_id);

      await display.pushAndForget({ movie });

      const year = movieYear(movie);
      const director = getDirector(movie);
      const cast = getTopCast(movie, 5);
      const castNames = cast.map((c) => c.name).join(", ");
      const overviewSnippet =
        movie.overview.length > 200
          ? movie.overview.substring(0, 200) + "..."
          : movie.overview;

      return {
        status: "success" as const,
        data: `${movie.title} (${year}), directed by ${director}. ${overviewSnippet} Stars: ${castNames}. Rating: ${movie.vote_average.toFixed(1)}/10.`,
        renderData: { movie },
      };
    },
    render({ props }) {
      return <MovieInfoCard movie={props.movie as TMDBMovie} />;
    },
    renderResult({ data }) {
      const result = data as MovieInfoCardProps;
      return <MovieInfoCard movie={result.movie as TMDBMovie} />;
    },
  });
}
