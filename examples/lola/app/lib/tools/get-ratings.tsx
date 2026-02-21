import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { CHARCOAL, AMBER, CREAM, CREAM_MUTED } from "../theme";
import { getMovieDetails, movieYear } from "../tmdb";

// ─── get_ratings — compact rating card (pushAndForget) ──────────────────────

interface RatingsCardProps {
  title: string;
  year: string;
  score: number;
  voteCount: number;
}

function scoreColor(score: number): string {
  if (score >= 7) return AMBER[400];
  if (score >= 5) return CREAM;
  return CHARCOAL[500];
}

function formatVoteCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function RatingsCard({ title, year, score, voteCount }: RatingsCardProps) {
  const color = scoreColor(score);
  const barWidth = Math.max(0, Math.min(100, (score / 10) * 100));

  return (
    <div
      style={{
        background: CHARCOAL[900],
        border: `1px solid ${CHARCOAL[700]}`,
        padding: 20,
        maxWidth: 360,
        width: "100%",
        boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Title + Year */}
      <div style={{ marginBottom: 14 }}>
        <h4
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 18,
            fontWeight: 400,
            color: CREAM,
            margin: 0,
            lineHeight: 1.25,
          }}
        >
          {title}
        </h4>
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: CREAM_MUTED,
            marginTop: 2,
            display: "block",
          }}
        >
          {year}
        </span>
      </div>

      {/* Score display */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 42,
            fontWeight: 500,
            color,
            lineHeight: 1,
            textShadow: color === AMBER[400] ? "0 0 30px rgba(245, 166, 35, 0.3)" : "none",
          }}
        >
          {score.toFixed(1)}
        </span>
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 14,
            color: CREAM_MUTED,
          }}
        >
          / 10
        </span>
      </div>

      {/* Vote count */}
      <span
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          color: CREAM_MUTED,
          display: "block",
          marginBottom: 10,
        }}
      >
        Based on {formatVoteCount(voteCount)} votes
      </span>

      {/* Horizontal bar */}
      <div
        style={{
          width: "100%",
          height: 6,
          background: CHARCOAL[700],
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${barWidth}%`,
            height: "100%",
            background: color,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

export function createGetRatingsTool() {
  return defineTool({
    name: "get_ratings",
    description:
      "Get the audience rating and vote count for a specific movie. Shows a compact visual rating card with a score bar.",
    inputSchema: z.object({
      movie_id: z.number().describe("TMDB movie ID"),
    }),
    displayPropsSchema: z.object({
      title: z.string(),
      year: z.string(),
      score: z.number(),
      voteCount: z.number(),
    }),
    async do(input, display) {
      const movie = await getMovieDetails(input.movie_id);
      const year = movieYear(movie);

      const cardProps: RatingsCardProps = {
        title: movie.title,
        year,
        score: movie.vote_average,
        voteCount: movie.vote_count,
      };

      await display.pushAndForget(cardProps);

      return {
        status: "success" as const,
        data: `${movie.title}: ${movie.vote_average.toFixed(1)}/10 based on ${formatVoteCount(movie.vote_count)} votes`,
        renderData: cardProps,
      };
    },
    render({ props }) {
      return <RatingsCard {...props} />;
    },
    renderResult({ data }) {
      const result = data as RatingsCardProps;
      return <RatingsCard {...result} />;
    },
  });
}
