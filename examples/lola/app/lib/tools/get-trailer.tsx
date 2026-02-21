import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { CHARCOAL, CREAM, CREAM_MUTED } from "../theme";
import {
  getMovieDetails,
  getTrailer,
  youtubeEmbedUrl,
} from "../tmdb";

// ─── get_trailer — embedded YouTube trailer (pushAndForget) ─────────────────

interface TrailerEmbedProps {
  title: string;
  youtubeKey: string | null;
  videoName: string | null;
}

function TrailerEmbed({ title, youtubeKey, videoName }: TrailerEmbedProps) {
  if (!youtubeKey) {
    return (
      <div
        style={{
          background: CHARCOAL[900],
          border: `1px solid ${CHARCOAL[700]}`,
          padding: 24,
          maxWidth: 500,
          width: "100%",
          boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)",
        }}
      >
        <h4
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 18,
            fontWeight: 400,
            color: CREAM,
            margin: "0 0 8px",
          }}
        >
          {title}
        </h4>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
            color: CREAM_MUTED,
            fontStyle: "italic",
            margin: 0,
          }}
        >
          No trailer available for this title.
        </p>
      </div>
    );
  }

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
      {/* Title bar */}
      <div style={{ padding: "12px 16px" }}>
        <h4
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 18,
            fontWeight: 400,
            color: CREAM,
            margin: 0,
          }}
        >
          {title}
        </h4>
        {videoName && (
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 11,
              color: CREAM_MUTED,
              marginTop: 2,
              display: "block",
            }}
          >
            {videoName}
          </span>
        )}
      </div>

      {/* 16:9 iframe container */}
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingBottom: "56.25%",
          height: 0,
          overflow: "hidden",
        }}
      >
        <iframe
          src={youtubeEmbedUrl(youtubeKey)}
          title={`${title} - Trailer`}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: "none",
          }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}

export function createGetTrailerTool() {
  return defineTool({
    name: "get_trailer",
    description:
      "Find and display the official trailer for a movie. Embeds the YouTube trailer directly in the chat for the user to watch.",
    inputSchema: z.object({
      movie_id: z.number().describe("TMDB movie ID"),
    }),
    displayPropsSchema: z.object({
      title: z.string(),
      youtubeKey: z.string().nullable(),
      videoName: z.string().nullable(),
    }),
    async do(input, display) {
      const movie = await getMovieDetails(input.movie_id);
      const trailer = getTrailer(movie);

      const cardProps: TrailerEmbedProps = {
        title: movie.title,
        youtubeKey: trailer?.key ?? null,
        videoName: trailer?.name ?? null,
      };

      await display.pushAndForget(cardProps);

      if (trailer) {
        return {
          status: "success" as const,
          data: `Trailer for ${movie.title} is now playing on screen.`,
          renderData: cardProps,
        };
      }

      return {
        status: "success" as const,
        data: `No trailer available for ${movie.title}.`,
        renderData: cardProps,
      };
    },
    render({ props }) {
      return <TrailerEmbed {...props} />;
    },
    renderResult({ data }) {
      const result = data as TrailerEmbedProps;
      return <TrailerEmbed {...result} />;
    },
  });
}
