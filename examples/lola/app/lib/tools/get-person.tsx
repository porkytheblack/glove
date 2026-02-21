import React from "react";
import { defineTool } from "glove-react";
import { z } from "zod";
import { CHARCOAL, AMBER, CREAM, CREAM_MUTED, CREAM_DIM } from "../theme";
import {
  getPersonDetails,
  searchPerson,
  profileUrl,
  posterUrl,
  truncateBio,
  type TMDBPerson,
  type TMDBMovieCredit,
} from "../tmdb";

// ─── get_person — actor/director profile card (pushAndForget) ───────────────

interface PersonCardProps {
  person: TMDBPerson;
  topFilms: TMDBMovieCredit[];
}

function PersonCard({ person, topFilms }: PersonCardProps) {
  const photo = profileUrl(person.profile_path, "w185");
  const bio = truncateBio(person.biography, 3);
  const birthYear = person.birthday ? person.birthday.substring(0, 4) : null;
  const deathYear = person.deathday ? person.deathday.substring(0, 4) : null;
  const lifespan = birthYear
    ? deathYear
      ? `${birthYear} -- ${deathYear}`
      : `Born ${birthYear}`
    : null;

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
      <div style={{ display: "flex", gap: 16, padding: 16 }}>
        {/* Profile photo */}
        {photo ? (
          <img
            src={photo}
            alt={person.name}
            style={{
              width: 100,
              height: 140,
              objectFit: "cover",
              flexShrink: 0,
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              width: 100,
              height: 140,
              background: CHARCOAL[700],
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: CHARCOAL[500],
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 11,
            }}
          >
            No Photo
          </div>
        )}

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 22,
              fontWeight: 400,
              color: CREAM,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {person.name}
          </h3>
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 11,
              color: AMBER[300],
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 500,
              display: "block",
              marginTop: 4,
            }}
          >
            {person.known_for_department}
          </span>
          {lifespan && (
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: CREAM_MUTED,
                display: "block",
                marginTop: 4,
              }}
            >
              {lifespan}
            </span>
          )}
          {person.place_of_birth && (
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 11,
                color: CREAM_MUTED,
                display: "block",
                marginTop: 2,
              }}
            >
              {person.place_of_birth}
            </span>
          )}
        </div>
      </div>

      {/* Bio */}
      {bio && (
        <div
          style={{
            padding: "0 16px 14px",
          }}
        >
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 12,
              lineHeight: 1.65,
              color: CREAM,
              margin: 0,
            }}
          >
            {bio}
          </p>
        </div>
      )}

      {/* Top Films */}
      {topFilms.length > 0 && (
        <div
          style={{
            padding: "12px 16px 14px",
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
              marginBottom: 10,
            }}
          >
            Notable Films
          </span>
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 4,
              scrollbarWidth: "none",
            }}
          >
            {topFilms.map((film) => {
              const thumb = posterUrl(film.poster_path, "w92");
              const title = film.title ?? film.name ?? "Untitled";
              return (
                <div
                  key={film.id}
                  style={{
                    flex: "0 0 auto",
                    width: 64,
                    textAlign: "center",
                  }}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={title}
                      style={{
                        width: 64,
                        height: 96,
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 96,
                        background: CHARCOAL[700],
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
                  <span
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 9,
                      color: CREAM_MUTED,
                      display: "block",
                      marginTop: 4,
                      lineHeight: 1.2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function getTopFilms(person: TMDBPerson, count: number): TMDBMovieCredit[] {
  const credits = person.combined_credits;
  if (!credits) return [];

  // Combine cast and crew credits, preferring movies
  const allCredits: TMDBMovieCredit[] = [
    ...credits.cast.filter((c) => c.media_type === "movie"),
    ...credits.crew.filter((c) => c.media_type === "movie" && c.job === "Director"),
  ];

  // Deduplicate by id
  const seen = new Set<number>();
  const unique: TMDBMovieCredit[] = [];
  for (const credit of allCredits) {
    if (!seen.has(credit.id)) {
      seen.add(credit.id);
      unique.push(credit);
    }
  }

  // Sort by popularity descending
  unique.sort((a, b) => b.popularity - a.popularity);

  return unique.slice(0, count);
}

export function createGetPersonTool() {
  return defineTool({
    name: "get_person",
    description:
      "Get details about an actor, director, or other film personality. Shows their profile photo, biography, and top films. Can search by name or look up by TMDB person ID.",
    inputSchema: z.object({
      person_id: z.number().optional().describe("TMDB person ID"),
      name: z.string().optional().describe("Person name to search for"),
    }),
    displayPropsSchema: z.object({
      person: z.any(),
      topFilms: z.array(z.any()),
    }),
    async do(input, display) {
      let personId = input.person_id;

      if (!personId && input.name) {
        const results = await searchPerson(input.name);
        if (results.length === 0) {
          return {
            status: "success" as const,
            data: `No person found matching "${input.name}".`,
            renderData: { person: null, topFilms: [] },
          };
        }
        personId = results[0].id;
      }

      if (!personId) {
        return {
          status: "error" as const,
          data: "Either person_id or name must be provided.",
          renderData: { person: null, topFilms: [] },
        };
      }

      const person = await getPersonDetails(personId);
      const topFilms = getTopFilms(person, 5);

      await display.pushAndForget({ person, topFilms });

      const filmTitles = topFilms
        .map((f) => f.title ?? f.name ?? "Untitled")
        .join(", ");

      return {
        status: "success" as const,
        data: `${person.name} is known for ${person.known_for_department}. Notable films: ${filmTitles}.`,
        renderData: { person, topFilms },
      };
    },
    render({ props }) {
      const person = props.person as TMDBPerson | null;
      const topFilms = props.topFilms as TMDBMovieCredit[];
      if (!person) return null;
      return <PersonCard person={person} topFilms={topFilms} />;
    },
    renderResult({ data }) {
      const result = data as PersonCardProps;
      if (!result.person) return null;
      return (
        <PersonCard
          person={result.person as TMDBPerson}
          topFilms={result.topFilms as TMDBMovieCredit[]}
        />
      );
    },
  });
}
