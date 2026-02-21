import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { CHARCOAL, CREAM, CREAM_MUTED, CREAM_DIM } from "../theme";
import {
  getMovieDetails,
  getProviders,
  providerLogoUrl,
  type TMDBProvider,
  type TMDBProviderData,
} from "../tmdb";

// ─── get_streaming — provider badges grouped by type (pushAndForget) ────────

interface StreamingBadgesProps {
  title: string;
  providers: TMDBProviderData | null;
}

interface ProviderSectionProps {
  label: string;
  items: TMDBProvider[];
}

function ProviderBadge({ provider }: { provider: TMDBProvider }) {
  const logo = providerLogoUrl(provider.logo_path, "w45");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: CHARCOAL[700],
        padding: "6px 10px",
      }}
    >
      {logo && (
        <img
          src={logo}
          alt={provider.provider_name}
          style={{
            width: 20,
            height: 20,
            objectFit: "contain",
            display: "block",
          }}
        />
      )}
      <span
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          color: CREAM,
        }}
      >
        {provider.provider_name}
      </span>
    </div>
  );
}

function ProviderSection({ label, items }: ProviderSectionProps) {
  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
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
        {label}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {items.map((p) => (
          <ProviderBadge key={p.provider_id} provider={p} />
        ))}
      </div>
    </div>
  );
}

function StreamingBadges({ title, providers }: StreamingBadgesProps) {
  const hasAny =
    providers &&
    ((providers.flatrate && providers.flatrate.length > 0) ||
      (providers.rent && providers.rent.length > 0) ||
      (providers.buy && providers.buy.length > 0) ||
      (providers.ads && providers.ads.length > 0));

  return (
    <div
      style={{
        background: CHARCOAL[900],
        border: `1px solid ${CHARCOAL[700]}`,
        padding: 20,
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
          margin: "0 0 14px",
        }}
      >
        {title}
      </h4>

      {hasAny ? (
        <>
          <ProviderSection label="Stream" items={providers.flatrate ?? []} />
          <ProviderSection label="With Ads" items={providers.ads ?? []} />
          <ProviderSection label="Rent" items={providers.rent ?? []} />
          <ProviderSection label="Buy" items={providers.buy ?? []} />
        </>
      ) : (
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
            color: CREAM_MUTED,
            fontStyle: "italic",
            margin: 0,
          }}
        >
          No streaming info available for this region.
        </p>
      )}
    </div>
  );
}

function buildProviderText(providers: TMDBProviderData | null): string {
  if (!providers) return "";

  const parts: string[] = [];

  if (providers.flatrate && providers.flatrate.length > 0) {
    const names = providers.flatrate.map((p) => p.provider_name).join(", ");
    parts.push(`Stream on ${names}`);
  }
  if (providers.ads && providers.ads.length > 0) {
    const names = providers.ads.map((p) => p.provider_name).join(", ");
    parts.push(`Free with ads on ${names}`);
  }
  if (providers.rent && providers.rent.length > 0) {
    const names = providers.rent.map((p) => p.provider_name).join(", ");
    parts.push(`Rent on ${names}`);
  }
  if (providers.buy && providers.buy.length > 0) {
    const names = providers.buy.map((p) => p.provider_name).join(", ");
    parts.push(`Buy on ${names}`);
  }

  return parts.join(". ");
}

export function createGetStreamingTool() {
  return defineTool({
    name: "get_streaming",
    description:
      "Check where a movie is available to stream, rent, or buy. Shows provider logos grouped by availability type (subscription, rent, buy).",
    inputSchema: z.object({
      movie_id: z.number().describe("TMDB movie ID"),
      country: z.string().optional().default("US").describe("Country code"),
    }),
    displayPropsSchema: z.object({
      title: z.string(),
      providers: z.any(),
    }),
    async do(input, display) {
      const movie = await getMovieDetails(input.movie_id);
      const country = input.country ?? "US";
      const providers = getProviders(movie, country);

      const cardProps: StreamingBadgesProps = {
        title: movie.title,
        providers,
      };

      await display.pushAndForget(cardProps);

      const providerText = buildProviderText(providers);
      const dataText = providerText
        ? `${movie.title} is available: ${providerText}.`
        : `No streaming info available for ${movie.title} in ${country}.`;

      return {
        status: "success" as const,
        data: dataText,
        renderData: cardProps,
      };
    },
    render({ props }) {
      return (
        <StreamingBadges
          title={props.title}
          providers={props.providers as TMDBProviderData | null}
        />
      );
    },
    renderResult({ data }) {
      const result = data as StreamingBadgesProps;
      return (
        <StreamingBadges
          title={result.title}
          providers={result.providers as TMDBProviderData | null}
        />
      );
    },
  });
}
