import { CodeBlock } from "@/components/code-block";

export default async function LolaPage() {
  return (
    <div className="docs-content">
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Build a Movie Companion</h1>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(245, 166, 35, 0.12)",
            border: "1px solid rgba(245, 166, 35, 0.3)",
            color: "#f5a623",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.04em",
            padding: "4px 12px",
            borderRadius: 4,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            lineHeight: 1.5,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="1" width="6" height="14" rx="3" />
            <path d="M19 10v2a7 7 0 01-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          Voice-First
        </span>
      </div>

      <p>
        In this tutorial you will build <strong>Lola</strong>, a voice-first
        movie companion powered by TMDB. The user speaks, Lola responds with
        voice narration and visual cards &mdash; poster grids, movie info,
        trailers, comparisons, and streaming availability. There is a text
        input as a fallback, but voice is the primary interaction mode.
      </p>

      <p>
        This is fundamentally different from adding voice to an existing
        chat app. In a <em>voice-enabled</em> app (like a coffee shop
        ordering assistant), you start with text and add voice as a
        secondary input. In a <em>voice-first</em> app, voice is the
        default. The screen is not a chat column &mdash; it is a visual
        area that shows ambient, glanceable cards while the AI narrates the
        content out loud. Every tool uses{" "}
        <code>pushAndForget</code> because nothing should ever block the
        voice conversation.
      </p>

      <p>
        <strong>Prerequisites:</strong> You should have completed{" "}
        <a href="/docs/getting-started">Getting Started</a>, read{" "}
        <a href="/docs/display-stack">The Display Stack</a>, and reviewed{" "}
        <a href="/docs/voice">Voice Integration</a>.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>What you will build</h2>

      <p>
        A movie companion where the user taps a voice orb and says
        &ldquo;Tell me about Inception&rdquo; and the app will:
      </p>

      <ol>
        <li>
          Transcribe the user&apos;s speech to text using ElevenLabs
          speech-to-text
        </li>
        <li>
          Send the text to the LLM, which calls{" "}
          <code>search_movies</code> &mdash; a poster grid appears on
          screen (<code>pushAndForget</code>)
        </li>
        <li>
          The LLM narrates the search results out loud while the user
          sees the poster cards
        </li>
        <li>
          The LLM calls <code>get_movie_details</code> &mdash; a
          detailed info card replaces the poster grid
          (<code>pushAndForget</code>)
        </li>
        <li>
          Lola describes the director, cast, and plot verbally while the
          card is visible
        </li>
        <li>
          The user says &ldquo;Show me the trailer&rdquo; &mdash; a
          YouTube embed appears (<code>pushAndForget</code>)
        </li>
      </ol>

      <p>
        Nine tools, one TMDB proxy route. The user never types unless they
        choose to. The visual area shows the most recent tool result; the
        transcript strip shows Lola&apos;s latest spoken words in serif
        font near the bottom of the screen; the voice orb communicates the
        current state through animation.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Voice-first vs. voice-enabled</h2>

      <p>
        Before diving into code, it is important to understand the
        distinction between voice-first and voice-enabled. Both use the
        same <code>glove-voice</code> package, but the design decisions
        are opposite.
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Aspect</th>
            <th>Voice-Enabled (Coffee Shop)</th>
            <th>Voice-First (Lola)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Primary input</td>
            <td>Text &mdash; voice is secondary</td>
            <td>Voice &mdash; text is a fallback</td>
          </tr>
          <tr>
            <td>Screen layout</td>
            <td>Chat column with messages</td>
            <td>Visual area + transcript strip + voice orb</td>
          </tr>
          <tr>
            <td>Tool blocking</td>
            <td>Mix of <code>pushAndWait</code> and <code>pushAndForget</code></td>
            <td>All tools use <code>pushAndForget</code></td>
          </tr>
          <tr>
            <td>Tool results</td>
            <td>AI reads structured data, may substitute text</td>
            <td>AI narrates results verbally while card is visible</td>
          </tr>
          <tr>
            <td>User interaction with cards</td>
            <td>Click buttons, fill forms</td>
            <td>Glance at visual information &mdash; no clicks needed</td>
          </tr>
          <tr>
            <td>System prompt</td>
            <td>Same prompt for text and voice</td>
            <td>Different prompt for voice mode (narration instructions)</td>
          </tr>
        </tbody>
      </table>

      <p>
        The key insight: in a voice-first app, if any tool uses{" "}
        <code>pushAndWait</code>, it blocks the LLM response loop. The
        agent cannot speak until the user clicks something on screen.
        That defeats the purpose of voice. Every tool must use{" "}
        <code>pushAndForget</code> so the visual card fires and the agent
        immediately narrates the content.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Architecture overview</h2>

      <p>
        Lola has three layers: a TMDB proxy that keeps the API key
        server-side, a voice pipeline (ElevenLabs + Silero VAD), and a
        screen layout built from three components.
      </p>

      <ul>
        <li>
          <strong><code>/api/tmdb/[...path]</code></strong> &mdash;
          a catch-all Next.js route that proxies requests to the TMDB
          API. The <code>TMDB_API_KEY</code> stays on the server.
          Client-side code calls <code>/api/tmdb/search/movie?query=...</code>{" "}
          and gets back raw TMDB JSON.
        </li>
        <li>
          <strong><code>/api/voice/stt-token</code> and{" "}
          <code>/api/voice/tts-token</code></strong> &mdash; token
          endpoints that generate short-lived ElevenLabs tokens. The
          browser uses these tokens to connect directly to ElevenLabs
          for speech-to-text and text-to-speech without exposing the
          API key.
        </li>
        <li>
          <strong><code>/api/chat</code></strong> &mdash; the standard
          Glove chat handler that proxies to the LLM.
        </li>
        <li>
          <strong>Visual Area</strong> &mdash; center of the screen.
          Shows active tool cards, the most recent completed tool
          result, or an empty state with suggestion chips.
        </li>
        <li>
          <strong>Transcript Strip</strong> &mdash; a line of serif
          text near the bottom showing Lola&apos;s last spoken words.
          Fades after four seconds of silence.
        </li>
        <li>
          <strong>Voice Orb</strong> &mdash; an 80px amber square with
          layered ring animations. Communicates listening, thinking,
          speaking, recording, and processing states.
        </li>
      </ul>

      {/* ------------------------------------------------------------------ */}
      <h2>1. Project setup</h2>

      <p>
        Start from a Next.js project with Glove and voice packages
        installed:
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add glove-core glove-react glove-next glove-voice zod`}
      />

      <p>
        Lola also uses <code>@ricky0123/vad-web</code> and{" "}
        <code>onnxruntime-web</code> for Silero VAD (voice activity
        detection &mdash; the browser-side model that detects when you
        start and stop speaking):
      </p>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`pnpm add @ricky0123/vad-web onnxruntime-web`}
      />

      <p>
        Create three environment variables:
      </p>

      <CodeBlock
        filename=".env.local"
        language="bash"
        code={`OPENROUTER_API_KEY=your-openrouter-key
TMDB_API_KEY=your-tmdb-v3-bearer-token
ELEVENLABS_API_KEY=your-elevenlabs-key`}
      />

      <p>
        The <strong>TMDB API key</strong> is a free bearer token from{" "}
        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">
          themoviedb.org
        </a>. The <strong>ElevenLabs API key</strong> comes from{" "}
        <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer">
          elevenlabs.io
        </a> (free tier works). The <strong>OpenRouter API key</strong> lets
        you use any model provider through a single endpoint.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>2. TMDB integration</h2>

      <p>
        The TMDB integration has two parts: a server-side proxy route that
        keeps your API key secret, and a client-side module with typed
        helper functions.
      </p>

      <h3>The proxy route</h3>

      <p>
        A single catch-all route forwards any path to the TMDB API with
        your bearer token attached:
      </p>

      <CodeBlock
        filename="app/api/tmdb/[...path]/route.ts"
        language="typescript"
        code={`import { NextResponse } from "next/server";

const TMDB_API_BASE = "https://api.themoviedb.org/3";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const url = new URL(req.url);

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "TMDB_API_KEY not set" }, { status: 500 });
  }

  const tmdbUrl = \`\${TMDB_API_BASE}/\${path.join("/")}?\${url.searchParams.toString()}\`;

  const res = await fetch(tmdbUrl, {
    headers: { Authorization: \`Bearer \${apiKey}\` },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}`}
      />

      <p>
        When client-side code calls{" "}
        <code>/api/tmdb/search/movie?query=Inception</code>, this route
        rewrites it to{" "}
        <code>https://api.themoviedb.org/3/search/movie?query=Inception</code>{" "}
        with the bearer token. The API key never reaches the browser.
      </p>

      <h3>Client-side helpers</h3>

      <p>
        A <code>tmdb.ts</code> module wraps the proxy with typed functions
        and image URL builders. Here are the key parts:
      </p>

      <CodeBlock
        filename="app/lib/tmdb.ts"
        language="typescript"
        code={`const API_BASE = "/api/tmdb";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export interface TMDBMovie {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  vote_average: number;
  vote_count: number;
  poster_path: string | null;
  backdrop_path: string | null;
  genres?: { id: number; name: string }[];
  runtime?: number;
  tagline?: string;
  credits?: {
    cast: TMDBCastMember[];
    crew: TMDBCrewMember[];
  };
  videos?: { results: TMDBVideo[] };
  "watch/providers"?: {
    results: Record<string, TMDBProviderData>;
  };
}

// Image URL helpers
export function posterUrl(
  path: string | null,
  size: "w92" | "w154" | "w185" | "w342" | "w500" | "w780" | "original" = "w342",
): string | null {
  if (!path) return null;
  return \`\${TMDB_IMAGE_BASE}/\${size}\${path}\`;
}

// Internal fetch helper — all calls go through the proxy
async function tmdbFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(\`\${API_BASE}/\${path}\`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "Unknown error");
    throw new Error(\`TMDB API error (\${res.status}): \${errorBody}\`);
  }
  return res.json() as Promise<T>;
}

// API functions
export async function searchMovies(query: string, year?: number): Promise<TMDBMovie[]> {
  const params: Record<string, string> = { query };
  if (year) params.year = String(year);
  const data = await tmdbFetch<{ results: TMDBMovie[] }>("search/movie", params);
  return data.results;
}

export async function getMovieDetails(movieId: number): Promise<TMDBMovie> {
  return tmdbFetch<TMDBMovie>(\`movie/\${movieId}\`, {
    append_to_response: "credits,videos,watch/providers",
  });
}

// Utility helpers
export function movieYear(movie: TMDBMovie): string {
  if (!movie.release_date) return "Unknown";
  return movie.release_date.substring(0, 4);
}

export function getDirector(movie: TMDBMovie): string {
  if (!movie.credits?.crew) return "Unknown";
  const director = movie.credits.crew.find((c) => c.job === "Director");
  return director?.name ?? "Unknown";
}

export function getTopCast(movie: TMDBMovie, count: number = 5): TMDBCastMember[] {
  if (!movie.credits?.cast) return [];
  return movie.credits.cast.sort((a, b) => a.order - b.order).slice(0, count);
}`}
      />

      <p>
        Every TMDB call goes through <code>tmdbFetch</code>, which
        constructs a URL pointing at <code>/api/tmdb/...</code> and
        parses the JSON response. The typed return values mean your tool
        <code>do</code> functions get full autocomplete for
        movie fields, cast members, and provider data.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>3. Tool design for voice</h2>

      <p>
        Voice-first tools follow a specific pattern. Every tool:
      </p>

      <ol>
        <li>Fetches data from the TMDB proxy</li>
        <li>
          Calls <code>display.pushAndForget()</code> with the visual
          card data
        </li>
        <li>
          Returns a <strong>descriptive text string</strong> that the LLM
          uses for narration, plus <code>renderData</code> for
          persisting the visual card
        </li>
      </ol>

      <p>
        The text return is critical. In a text-only app, the LLM reads the
        tool result and decides what to say. In a voice-first app, the LLM
        reads the tool result and <em>speaks</em> it. The tool must return
        enough information for the LLM to give a natural verbal summary,
        not just &ldquo;Done&rdquo; or a raw JSON blob.
      </p>

      <h3>search_movies</h3>

      <p>
        The search tool is the most common entry point. The user says
        &ldquo;Find me sci-fi movies from the 90s&rdquo; and the tool
        shows a poster grid while returning a numbered text list for
        narration.
      </p>

      <CodeBlock
        filename="app/lib/tools/search-movies.tsx"
        language="tsx"
        code={`import { defineTool } from "glove-react";
import { z } from "zod";
import { searchMovies, posterUrl, movieYear, type TMDBMovie } from "../tmdb";

export function createSearchMoviesTool() {
  return defineTool({
    name: "search_movies",
    description:
      "Search for movies by title. Returns a visual grid of poster cards " +
      "and text results for narration.",
    inputSchema: z.object({
      query: z.string().describe("Search query for movies"),
      year: z.number().optional().describe("Filter by release year"),
      max_results: z.number().optional().default(4).describe("Max results (1-6)"),
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
          data: \`No movies found matching "\${input.query}".\`,
          renderData: { movies: [] },
        };
      }

      // Fire the visual card — does NOT block the LLM
      await display.pushAndForget({ movies });

      // Return descriptive text for voice narration
      const summaryLines = movies.map(
        (m, i) =>
          \`\${i + 1}. \${m.title} (\${movieYear(m)}) — Rating: \${m.vote_average.toFixed(1)}/10\`,
      );

      return {
        status: "success" as const,
        data: \`Found \${movies.length} result(s) for "\${input.query}":\\n\${summaryLines.join("\\n")}\`,
        renderData: { movies },
      };
    },

    render({ props }) {
      const movies = props.movies as TMDBMovie[];
      return (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          {movies.map((movie) => (
            <PosterCard key={movie.id} movie={movie} />
          ))}
        </div>
      );
    },

    renderResult({ data }) {
      const result = data as { movies: TMDBMovie[] };
      return (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          {result.movies.map((movie) => (
            <PosterCard key={movie.id} movie={movie} />
          ))}
        </div>
      );
    },
  });
}`}
      />

      <p>
        The <code>data</code> string returned to the LLM includes titles,
        years, and ratings in a numbered list. In voice mode, the LLM reads
        this and says something like: &ldquo;Here are four results. First
        up is Inception from 2010, a solid 8.4. Then we have Interstellar,
        also from Nolan...&rdquo; Meanwhile the poster grid is already
        visible on screen.
      </p>

      <h3>get_movie_details</h3>

      <p>
        When the user asks about a specific film, this tool fetches full
        details including credits, videos, and streaming providers in a
        single TMDB call (using <code>append_to_response</code>). The
        visual card shows a backdrop image, genre tags, cast list, and
        director. The text return gives the LLM enough to narrate a
        compelling summary.
      </p>

      <CodeBlock
        filename="app/lib/tools/get-movie-details.tsx"
        language="tsx"
        code={`import { defineTool } from "glove-react";
import { z } from "zod";
import {
  getMovieDetails,
  backdropUrl,
  movieYear,
  formatRuntime,
  getDirector,
  getTopCast,
  genreNames,
  type TMDBMovie,
} from "../tmdb";

export function createGetMovieDetailsTool() {
  return defineTool({
    name: "get_movie_details",
    description:
      "Get comprehensive details about a movie including overview, " +
      "cast, director, runtime, rating, genres, and streaming availability.",
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
        data: \`\${movie.title} (\${year}), directed by \${director}. \${overviewSnippet} Stars: \${castNames}. Rating: \${movie.vote_average.toFixed(1)}/10.\`,
        renderData: { movie },
      };
    },

    render({ props }) {
      const movie = props.movie as TMDBMovie;
      return <MovieInfoCard movie={movie} />;
    },

    renderResult({ data }) {
      const result = data as { movie: TMDBMovie };
      return <MovieInfoCard movie={result.movie} />;
    },
  });
}`}
      />

      <p>
        Notice the <code>data</code> string: &ldquo;Inception (2010),
        directed by Christopher Nolan. A thief who steals corporate secrets
        through dream-sharing technology... Stars: Leonardo DiCaprio, Joseph
        Gordon-Levitt, Elliot Page... Rating: 8.4/10.&rdquo; The LLM
        uses this to speak naturally. It will not read it verbatim &mdash;
        the system prompt tells it to describe movies with feeling.
      </p>

      <h3>remember_preference (pure data, no UI)</h3>

      <p>
        Not every tool needs a visual component. The{" "}
        <code>remember_preference</code> tool silently stores user taste
        preferences. It has no <code>render</code> function and no{" "}
        <code>pushAndForget</code> call. The LLM acknowledges the
        preference verbally (&ldquo;Got it, you love Villeneuve&rdquo;)
        without showing anything on screen.
      </p>

      <CodeBlock
        filename="app/lib/tools/remember-preference.ts"
        language="typescript"
        code={`import { defineTool } from "glove-react";
import { z } from "zod";

export function createRememberPreferenceTool() {
  return defineTool({
    name: "remember_preference",
    description:
      "Remember a user preference about movies — favorite genres, " +
      "directors, actors, moods, or anything else. Data-only tool " +
      "with no visual display.",
    inputSchema: z.object({
      preference: z.string().describe("User preference to remember"),
      category: z
        .string()
        .optional()
        .describe("Category: genre, director, actor, mood, other"),
    }),
    displayPropsSchema: z.object({}),
    async do(input) {
      const category = input.category ?? "other";
      return {
        status: "success" as const,
        data: \`Noted preference (\${category}): \${input.preference}\`,
      };
    },
  });
}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>4. The complete tool inventory</h2>

      <p>
        Lola has nine tools, all using <code>pushAndForget</code> (except{" "}
        <code>remember_preference</code> which has no UI at all). Each tool
        returns descriptive text for narration alongside visual card data.
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Visual Card</th>
            <th>Narration Text</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>search_movies</code></td>
            <td>Poster grid with rating badges</td>
            <td>Numbered list of titles, years, and ratings</td>
          </tr>
          <tr>
            <td><code>get_movie_details</code></td>
            <td>Full info card: backdrop, genres, cast, director, overview</td>
            <td>Title, year, director, cast names, overview snippet, rating</td>
          </tr>
          <tr>
            <td><code>get_ratings</code></td>
            <td>Score display with rating bar and vote count</td>
            <td>Title, score out of 10, vote count</td>
          </tr>
          <tr>
            <td><code>get_trailer</code></td>
            <td>YouTube embed (16:9 aspect ratio)</td>
            <td>&ldquo;Trailer for [Title] is now playing on screen&rdquo;</td>
          </tr>
          <tr>
            <td><code>compare_movies</code></td>
            <td>Side-by-side cards (2&ndash;4 films) with posters and genres</td>
            <td>Per-movie summary: title, year, rating, runtime, genres</td>
          </tr>
          <tr>
            <td><code>get_recommendations</code></td>
            <td>Numbered list with poster thumbnails and overview snippets</td>
            <td>Numbered list of titles with brief descriptions</td>
          </tr>
          <tr>
            <td><code>get_person</code></td>
            <td>Profile card with photo, bio, and notable films</td>
            <td>Name, department, notable film titles</td>
          </tr>
          <tr>
            <td><code>get_streaming</code></td>
            <td>Provider badges grouped by type (stream, rent, buy)</td>
            <td>&ldquo;Stream on Netflix. Rent on Apple TV.&rdquo;</td>
          </tr>
          <tr>
            <td><code>remember_preference</code></td>
            <td>None</td>
            <td>LLM acknowledges verbally</td>
          </tr>
        </tbody>
      </table>

      <p>
        All tools are assembled in a single factory function:
      </p>

      <CodeBlock
        filename="app/lib/tools/index.ts"
        language="typescript"
        code={`import type { ToolConfig } from "glove-react";
import { createSearchMoviesTool } from "./search-movies";
import { createGetMovieDetailsTool } from "./get-movie-details";
import { createGetRatingsTool } from "./get-ratings";
import { createGetTrailerTool } from "./get-trailer";
import { createCompareMoviesTool } from "./compare-movies";
import { createGetRecommendationsTool } from "./get-recommendations";
import { createGetPersonTool } from "./get-person";
import { createGetStreamingTool } from "./get-streaming";
import { createRememberPreferenceTool } from "./remember-preference";

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
}`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>5. The visual area pattern</h2>

      <p>
        In a voice-first app, there is no scrolling chat column. The
        screen has a single <strong>visual area</strong> in the center
        that shows the most relevant content. The visual area has three
        states:
      </p>

      <ol>
        <li>
          <strong>Active slot</strong> &mdash; when a tool has just fired
          via <code>pushAndForget</code>, the visual area renders that
          tool&apos;s card. If multiple tools fire in sequence, the latest
          one wins.
        </li>
        <li>
          <strong>Last result</strong> &mdash; when no active slot exists
          but a previous tool has <code>renderData</code>, the visual
          area shows the most recent completed result. This means the
          movie info card stays visible even after the LLM finishes
          speaking.
        </li>
        <li>
          <strong>Empty state</strong> &mdash; when there is nothing to
          show and the agent is not busy, the visual area shows a
          cinematic onboarding screen with suggestion chips like
          &ldquo;Best sci-fi from the 90s&rdquo; or &ldquo;Something
          like Eternal Sunshine.&rdquo;
        </li>
      </ol>

      <CodeBlock
        filename="app/components/visual-area.tsx"
        language="tsx"
        code={`import { useMemo, type ReactNode } from "react";
import type { TimelineEntry, EnhancedSlot } from "glove-react";

interface VisualAreaProps {
  slots: EnhancedSlot[];
  timeline: TimelineEntry[];
  renderSlot: (slot: EnhancedSlot) => ReactNode;
  renderToolResult: (entry: TimelineEntry & { kind: "tool" }) => ReactNode;
  busy: boolean;
  onSuggestion?: (text: string) => void;
}

const SUGGESTIONS = [
  "Best sci-fi from the 90s",
  "Something like Eternal Sunshine",
  "Who directed Parasite?",
  "Cozy rainy day movies",
];

export function VisualArea({
  slots,
  timeline,
  renderSlot,
  renderToolResult,
  busy,
  onSuggestion,
}: VisualAreaProps) {
  const lastToolResult = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = timeline[i];
      if (
        entry.kind === "tool" &&
        entry.status === "success" &&
        entry.renderData !== undefined
      ) {
        return entry;
      }
    }
    return null;
  }, [timeline]);

  // Case 1: Active slots — render each via renderSlot
  if (slots.length > 0) {
    return (
      <div className="visual-area">
        {slots.map((slot) => (
          <div key={slot.id} className="display-card">
            {renderSlot(slot)}
          </div>
        ))}
      </div>
    );
  }

  // Case 2: Recent tool result with renderData
  if (lastToolResult) {
    const rendered = renderToolResult(lastToolResult);
    if (rendered) {
      return (
        <div className="visual-area">
          <div className="display-card">{rendered}</div>
        </div>
      );
    }
  }

  // Case 3: Empty state — suggestion chips
  if (!busy) {
    return (
      <div className="visual-area">
        <div className="lola-empty">
          <h1 className="lola-empty__title">Lola</h1>
          <p className="lola-empty__subtitle">
            Your voice-first movie companion.<br />
            Ask me anything about film.
          </p>
          {onSuggestion && (
            <div className="lola-empty__suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="lola-empty__chip"
                  onClick={() => onSuggestion(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return <div className="visual-area" />;
}`}
      />

      <p>
        The visual area is not a Glove concept &mdash; it is a UI pattern
        you build yourself using the <code>slots</code>,{" "}
        <code>timeline</code>, <code>renderSlot</code>, and{" "}
        <code>renderToolResult</code> values from <code>useGlove</code>.
        In a chat-based app you interleave slots into a message list.
        In a voice-first app you replace the entire center of the screen.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>6. Voice pipeline setup</h2>

      <p>
        The voice pipeline has three parts: speech-to-text (STT),
        text-to-speech (TTS), and voice activity detection (VAD). All
        three are configured in a single file.
      </p>

      <h3>Token routes</h3>

      <p>
        ElevenLabs requires short-lived tokens for browser-side
        connections. Glove provides a helper that generates these tokens
        from your API key:
      </p>

      <CodeBlock
        filename="app/api/voice/stt-token/route.ts"
        language="typescript"
        code={`import { createVoiceTokenHandler } from "glove-next";

export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "stt" });`}
      />

      <CodeBlock
        filename="app/api/voice/tts-token/route.ts"
        language="typescript"
        code={`import { createVoiceTokenHandler } from "glove-next";

export const GET = createVoiceTokenHandler({ provider: "elevenlabs", type: "tts" });`}
      />

      <h3>Voice adapters</h3>

      <p>
        The adapters connect the token routes to ElevenLabs and configure
        the voice. Lola uses the &ldquo;Charlotte&rdquo; voice &mdash; a
        warm, cinematic tone that fits the film companion persona:
      </p>

      <CodeBlock
        filename="app/lib/voice.ts"
        language="typescript"
        code={`import { createElevenLabsAdapters } from "glove-voice";

async function fetchToken(path: string): Promise<string> {
  const res = await fetch(path);
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !data.token) {
    throw new Error(data.error ?? \`Token fetch failed (\${res.status})\`);
  }
  return data.token;
}

export const { stt, createTTS } = createElevenLabsAdapters({
  getSTTToken: () => fetchToken("/api/voice/stt-token"),
  getTTSToken: () => fetchToken("/api/voice/tts-token"),
  voiceId: "XB0fDUnXU5powFXDhCwa", // "Charlotte" — warm, cinematic
});

export async function createSileroVAD() {
  const { SileroVADAdapter } = await import("glove-voice/silero-vad");
  const vad = new SileroVADAdapter({
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    wasm: { type: "cdn" },
  });
  await vad.init();
  return vad;
}`}
      />

      <p>
        <strong>Silero VAD</strong> is a small neural network that runs
        in the browser using WebAssembly. It listens to the microphone
        and detects when you start and stop speaking. This is what enables
        the hands-free &ldquo;auto&rdquo; turn mode &mdash; you speak, it
        detects silence, and it automatically sends your speech for
        transcription. The <code>positiveSpeechThreshold</code> and{" "}
        <code>negativeSpeechThreshold</code> control how sensitive the
        detection is.
      </p>

      <p>
        Silero VAD is imported dynamically with{" "}
        <code>await import(&quot;glove-voice/silero-vad&quot;)</code>{" "}
        because it loads an ONNX model file. Dynamic import keeps it out
        of the initial bundle and allows it to load the WebAssembly
        runtime on demand.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>7. The voice orb</h2>

      <p>
        The voice orb is the primary interaction element. It is an 80px
        sharp-cornered amber square that communicates state through
        layered ring animations. Think of it as a visual heartbeat for
        the voice pipeline.
      </p>

      <p>
        The orb has six states, each mapped to the{" "}
        <code>VoiceMode</code> from <code>useGloveVoice</code> plus two
        additional UI states for manual recording and processing:
      </p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>State</th>
            <th>Visual</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>idle</code></td>
            <td>Static amber square with mic icon</td>
            <td>Voice session not started; tap to begin</td>
          </tr>
          <tr>
            <td><code>listening</code></td>
            <td>Gentle breathing pulse on the outer ring</td>
            <td>Microphone is active, waiting for speech</td>
          </tr>
          <tr>
            <td><code>recording</code></td>
            <td>Warm orange pulse on the core</td>
            <td>Manual mode: actively capturing your voice</td>
          </tr>
          <tr>
            <td><code>processing</code></td>
            <td>Subdued spin on the middle ring</td>
            <td>Finalizing transcription before sending to LLM</td>
          </tr>
          <tr>
            <td><code>thinking</code></td>
            <td>Counter-rotating dashed rings</td>
            <td>LLM is generating a response (tool calls, text)</td>
          </tr>
          <tr>
            <td><code>speaking</code></td>
            <td>Concentric ripples expanding outward</td>
            <td>Lola is speaking; tap to interrupt</td>
          </tr>
        </tbody>
      </table>

      <p>
        The orb click handler adapts to the current state:
      </p>

      <CodeBlock
        filename="app/components/voice-orb.tsx (click handler)"
        language="typescript"
        code={`const handleClick = () => {
  if (mode === "speaking") {
    onInterrupt();         // Tap while speaking → interrupt
  } else if (isProcessing) {
    onStop();              // Tap while processing → cancel
  } else if (isManual && mode === "listening") {
    if (isManualRecording) {
      onManualRecordStop();  // Tap while recording → send
    } else {
      onManualRecordStart(); // Tap while idle → start recording
    }
  } else {
    onStop();              // Tap otherwise → end voice session
  }
};`}
      />

      <p>
        The orb also shows a status label beneath it. In listening mode it
        says &ldquo;Listening&rdquo;; while recording it shows the live
        transcript; while thinking it says &ldquo;Thinking&rdquo;; while
        speaking it says &ldquo;Speaking.&rdquo; In manual mode with no
        recording active, it shows &ldquo;Hold space or tap to speak.&rdquo;
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>8. Dynamic system prompt for voice</h2>

      <p>
        Lola uses two system prompts. The base prompt defines her
        personality and tool usage guidelines. The voice prompt extends
        the base with narration instructions.
      </p>

      <CodeBlock
        filename="app/lib/system-prompt.ts"
        language="typescript"
        code={[
          'export const systemPrompt = `You are Lola, a passionate and knowledgeable movie companion.',
          '',
          '## Your Personality',
          '- Genuinely passionate about cinema across all genres and eras',
          '- Warm but opinionated — you have taste but respect others\' preferences',
          '- Concise — 1-2 sentences between tool calls. Let the visual cards do the talking.',
          '- You describe movies by feel, not data — "gorgeous, melancholic road trip" not "received 7.8 on IMDb"',
          '',
          '## Tool Usage Guidelines',
          '- ALWAYS use visual tools — never list movies as plain text',
          '- Use search_movies for any movie search',
          '- Use get_movie_details when discussing a specific film in depth',
          '- Use get_trailer proactively when it would enhance the conversation',
          '- Keep text responses SHORT — let the visual cards speak`;',
          '',
          'export const voiceSystemPrompt = `${systemPrompt}',
          '',
          '## Voice Mode — IMPORTANT',
          'The user is interacting via voice. All tools display visual cards on screen.',
          'You MUST ALSO describe things verbally since the user may not be looking at the screen.',
          '',
          '### After Each Tool',
          '- search_movies: Briefly narrate the top 2-3 results — title, year, one line each',
          '- get_movie_details: Highlight the director, lead actors, and a sentence about the plot',
          '- get_ratings: Speak the score and what it means ("solid 8.1 — critics loved it")',
          '- get_trailer: Let them know the trailer is playing on screen',
          '- compare_movies: Summarize the key differences verbally',
          '- get_recommendations: Read out the top 2-3 picks with brief reasons',
          '- get_person: Mention their most notable roles',
          '- get_streaming_availability: Tell them where it\'s available',
          '- remember_preference: Just acknowledge verbally ("Got it, noted.")',
          '',
          '### Speaking Style',
          '- Conversational — like a friend who loves movies, chatting on the couch',
          '- Describe movies with feeling — "It\'s this gorgeous, melancholic road trip"',
          '- Keep it concise for voice — shorter than text responses',
          '- Ask one thing at a time — don\'t overwhelm',
          '- Never read metadata robotically — translate data into human sentences`;',
        ].join('\n')}
      />

      <p>
        The swap happens at runtime. When the voice session starts, the
        orchestrator calls <code>runnable.setSystemPrompt(voiceSystemPrompt)</code>.
        When voice stops, it reverts to the base prompt. This means the
        LLM&apos;s behavior changes dynamically &mdash; in voice mode it
        narrates tool results, in text mode it keeps responses short and
        lets the cards speak.
      </p>

      <CodeBlock
        filename="app/components/lola.tsx (prompt swap)"
        language="typescript"
        code={`useEffect(() => {
  if (!runnable) return;
  if (voice.isActive) {
    runnable.setSystemPrompt(voiceSystemPrompt);
  } else {
    runnable.setSystemPrompt(systemPrompt);
  }
}, [voice.isActive, runnable]);`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>9. Wiring it all together</h2>

      <p>
        The <code>Lola</code> component is the orchestrator. It
        initializes <code>useGlove</code> with the tools, sets up the
        voice pipeline with <code>useGloveVoice</code>, manages VAD
        initialization, handles the thinking sound loop, and renders the
        three-part layout.
      </p>

      <CodeBlock
        filename="app/lib/client.ts"
        language="typescript"
        code={`import { GloveClient, createRemoteStore } from "glove-react";
import { systemPrompt } from "./system-prompt";
import { storeActions } from "./store-actions";

export const gloveClient = new GloveClient({
  endpoint: "/api/chat",
  systemPrompt,
  createStore: (sessionId) => createRemoteStore(sessionId, storeActions),
});`}
      />

      <CodeBlock
        filename="app/components/lola.tsx (orchestrator)"
        language="tsx"
        code={`"use client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useGlove } from "glove-react";
import { useGloveVoice } from "glove-react/voice";
import type { TurnMode } from "glove-react/voice";
import { createLolaTools } from "../lib/tools";
import { stt, createTTS, createSileroVAD } from "../lib/voice";
import { systemPrompt, voiceSystemPrompt } from "../lib/system-prompt";
import { VisualArea } from "./visual-area";
import { TranscriptStrip } from "./transcript-strip";
import { VoiceOrb } from "./voice-orb";
import { TextInput } from "./text-input";

interface LolaProps {
  sessionId: string;
  onFirstMessage?: (sessionId: string, text: string) => void;
}

export function Lola({ sessionId, onFirstMessage }: LolaProps) {
  const [turnMode, setTurnMode] = useState<TurnMode>("vad");
  const [isManualRecording, setIsManualRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [input, setInput] = useState("");
  const [vadReady, setVadReady] = useState(false);
  const vadRef = useRef<Awaited<ReturnType<typeof createSileroVAD>> | null>(null);

  const MIN_RECORDING_MS = 350;

  // Tools — created once, stable reference
  const tools = useMemo(() => createLolaTools(), []);

  // Glove hook — conversation engine
  const glove = useGlove({ tools, sessionId });
  const {
    runnable, timeline, streamingText, busy,
    slots, sendMessage, renderSlot, renderToolResult,
  } = glove;

  // Silero VAD — async initialization
  useEffect(() => {
    createSileroVAD().then((v) => {
      vadRef.current = v;
      setVadReady(true);
    });
  }, []);

  // Voice pipeline
  const voiceConfig = useMemo(
    () => ({
      stt,
      createTTS,
      vad: vadReady ? vadRef.current ?? undefined : undefined,
      turnMode,
    }),
    [vadReady, turnMode],
  );
  const voice = useGloveVoice({ runnable, voice: voiceConfig });

  // Dynamic system prompt swap
  useEffect(() => {
    if (!runnable) return;
    if (voice.isActive) {
      runnable.setSystemPrompt(voiceSystemPrompt);
    } else {
      runnable.setSystemPrompt(systemPrompt);
    }
  }, [voice.isActive, runnable]);

  // Thinking sound loop
  useEffect(() => {
    if (voice.mode !== "thinking") return;
    const audio = new Audio("/lola-thinking.mp3");
    audio.loop = true;
    audio.play().catch(() => {});
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [voice.mode]);

  // Last agent text from timeline for transcript strip
  const lastAgentText = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = timeline[i];
      if (entry.kind === "agent_text") return entry.text;
    }
    return "";
  }, [timeline]);

  return (
    <div className="lola-screen">
      <VisualArea
        slots={slots}
        timeline={timeline}
        renderSlot={renderSlot}
        renderToolResult={renderToolResult}
        busy={busy}
        onSuggestion={(text) => sendMessage(text)}
      />

      <TranscriptStrip
        text={streamingText || lastAgentText}
        isStreaming={!!streamingText}
      />

      <div className="orb-area">
        {voice.isActive ? (
          <VoiceOrb
            mode={voice.mode}
            transcript={voice.transcript}
            turnMode={turnMode}
            isManualRecording={isManualRecording}
            isProcessing={isProcessing}
            onStop={() => voice.stop()}
            onInterrupt={voice.interrupt}
            onManualRecordStart={() => { /* manual recording logic */ }}
            onManualRecordStop={() => { /* commit recording logic */ }}
          />
        ) : (
          <button
            className="voice-orb voice-orb--idle"
            onClick={() => voice.start()}
          >
            Start Voice
          </button>
        )}

        <TextInput
          visible={showTextInput}
          onToggle={() => setShowTextInput(!showTextInput)}
          input={input}
          setInput={setInput}
          busy={busy}
          onSubmit={(e) => {
            e.preventDefault();
            const text = input.trim();
            if (!text || busy) return;
            setInput("");
            sendMessage(text);
          }}
        />
      </div>
    </div>
  );
}`}
      />

      <p>
        The render structure is flat: <code>VisualArea</code> fills the
        center, <code>TranscriptStrip</code> sits near the bottom, and
        the <code>orb-area</code> holds the voice orb plus the optional
        text input. There is no chat column, no message list, no scroll.
        The visual area is the only place where tool output appears, and
        it shows only the most recent content.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>10. The transcript strip</h2>

      <p>
        The transcript strip shows Lola&apos;s most recent spoken or
        streamed text near the bottom of the screen. It is styled in serif
        font to match the cinematic aesthetic. While the LLM is streaming,
        a gentle pulse keeps the text alive. After four seconds of
        silence, the text fades to near-invisible so it does not compete
        with the visual area.
      </p>

      <CodeBlock
        filename="app/components/transcript-strip.tsx"
        language="tsx"
        code={`import { useEffect, useRef, useState } from "react";

interface TranscriptStripProps {
  text: string;
  isStreaming: boolean;
}

const FADE_DELAY_MS = 4000;

export function TranscriptStrip({ text, isStreaming }: TranscriptStripProps) {
  const [isFading, setIsFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTextRef = useRef(text);

  useEffect(() => {
    // Reset fade when text changes or streaming starts
    if (text !== prevTextRef.current || isStreaming) {
      prevTextRef.current = text;
      setIsFading(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    // Start fade timer when not streaming and text exists
    if (!isStreaming && text) {
      timerRef.current = setTimeout(() => {
        setIsFading(true);
        timerRef.current = null;
      }, FADE_DELAY_MS);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [text, isStreaming]);

  if (!text) return null;

  // Show the last ~180 characters, trimmed to a word boundary
  const displayText =
    text.length > 180
      ? "\\u2026" + text.slice(text.length - 180).replace(/^\\S*\\s/, "")
      : text;

  return (
    <div className="transcript-strip" role="status" aria-live="polite">
      <p
        className={\`transcript-strip__text \${
          isStreaming ? "transcript-strip__text--streaming" : ""
        } \${isFading ? "transcript-strip__text--fading" : ""}\`}
      >
        {displayText}
      </p>
    </div>
  );
}`}
      />

      <p>
        The 180-character trim ensures the strip never wraps excessively.
        For long narrations, it shows the tail end with a leading
        ellipsis. The <code>role=&quot;status&quot;</code> and{" "}
        <code>aria-live=&quot;polite&quot;</code> attributes ensure screen
        readers announce new text without interrupting the user.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>11. The thinking sound</h2>

      <p>
        When the LLM is processing (calling tools, generating text),
        Lola plays a subtle ambient sound loop. This gives the user
        audio feedback that something is happening, even when the screen
        has not changed yet.
      </p>

      <CodeBlock
        filename="app/components/lola.tsx (thinking sound)"
        language="typescript"
        code={`useEffect(() => {
  if (voice.mode !== "thinking") return;

  const audio = new Audio("/lola-thinking.mp3");
  audio.loop = true;
  audio.play().catch(() => {});

  return () => {
    audio.pause();
    audio.src = "";
  };
}, [voice.mode]);`}
      />

      <p>
        The <code>useEffect</code> cleanup function stops the sound
        immediately when the voice mode changes away from{" "}
        <code>&quot;thinking&quot;</code>. Setting <code>audio.src</code>{" "}
        to an empty string releases the audio resource. The{" "}
        <code>.catch(() =&gt; {"{}"});</code> handles browsers that block
        autoplay &mdash; the sound is a nice-to-have, not critical.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>12. Turn modes: auto vs. push-to-talk</h2>

      <p>
        Lola supports two turn modes for voice input:
      </p>

      <ul>
        <li>
          <strong>Auto (VAD)</strong> &mdash; Silero VAD detects when you
          start and stop speaking. After a pause, it automatically
          transcribes and sends your speech. This is the default and
          feels like a natural conversation.
        </li>
        <li>
          <strong>Push to talk (manual)</strong> &mdash; you hold the
          spacebar or tap the orb to record, then release to send. This
          is useful in noisy environments or when you want precise
          control over when your speech is captured.
        </li>
      </ul>

      <p>
        A toggle between these modes sits below the voice orb. It is only
        enabled when the voice pipeline is in the <code>listening</code>{" "}
        state &mdash; you cannot switch modes while the LLM is thinking
        or speaking.
      </p>

      <p>
        In manual mode, a 350ms minimum recording duration prevents false
        positive triggers. If you tap the orb briefly (under 350ms), the
        commit is delayed until the minimum threshold is reached. This
        avoids sending empty or garbled audio to the STT service.
      </p>

      <CodeBlock
        filename="app/components/lola.tsx (min-duration commit)"
        language="typescript"
        code={`const MIN_RECORDING_MS = 350;

const commitRecording = useCallback(() => {
  if (!recordingRef.current) return;
  recordingRef.current = false;
  setIsManualRecording(false);

  const elapsed = Date.now() - recordingStartRef.current;

  if (elapsed >= MIN_RECORDING_MS) {
    setIsProcessing(true);
    commitTurnRef.current();
  } else {
    // Delay commit until minimum recording duration
    setIsProcessing(true);
    const remaining = MIN_RECORDING_MS - elapsed;
    pendingCommitRef.current = setTimeout(() => {
      pendingCommitRef.current = null;
      commitTurnRef.current();
    }, remaining);
  }
}, []);`}
      />

      {/* ------------------------------------------------------------------ */}
      <h2>Display patterns summary</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Display Method</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>search_movies</code></td>
            <td><code>pushAndForget</code></td>
            <td>Poster grid appears instantly; LLM narrates results in parallel</td>
          </tr>
          <tr>
            <td><code>get_movie_details</code></td>
            <td><code>pushAndForget</code></td>
            <td>Info card appears; LLM describes the film verbally</td>
          </tr>
          <tr>
            <td><code>get_ratings</code></td>
            <td><code>pushAndForget</code></td>
            <td>Rating card appears; LLM speaks the score</td>
          </tr>
          <tr>
            <td><code>get_trailer</code></td>
            <td><code>pushAndForget</code></td>
            <td>YouTube embed appears; LLM says &ldquo;trailer is playing&rdquo;</td>
          </tr>
          <tr>
            <td><code>compare_movies</code></td>
            <td><code>pushAndForget</code></td>
            <td>Side-by-side cards appear; LLM summarizes differences</td>
          </tr>
          <tr>
            <td><code>get_recommendations</code></td>
            <td><code>pushAndForget</code></td>
            <td>Numbered list appears; LLM reads the top picks</td>
          </tr>
          <tr>
            <td><code>get_person</code></td>
            <td><code>pushAndForget</code></td>
            <td>Profile card appears; LLM mentions notable roles</td>
          </tr>
          <tr>
            <td><code>get_streaming</code></td>
            <td><code>pushAndForget</code></td>
            <td>Provider badges appear; LLM says where to watch</td>
          </tr>
          <tr>
            <td><code>remember_preference</code></td>
            <td>None</td>
            <td>Pure data &mdash; LLM acknowledges verbally, no UI</td>
          </tr>
        </tbody>
      </table>

      <p>
        Every single tool uses <code>pushAndForget</code>. There is no{" "}
        <code>pushAndWait</code> anywhere in the Lola codebase. This is
        the defining characteristic of a voice-first app. The moment you
        add a blocking tool, you break the voice flow.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>13. Design palette</h2>

      <p>
        Lola uses a charcoal + amber palette inspired by film noir
        aesthetics. The background is void black (<code>#0d0d0f</code>),
        cards use charcoal surfaces, and amber provides warmth for
        accents, ratings, and the voice orb.
      </p>

      <CodeBlock
        filename="app/lib/theme.ts"
        language="typescript"
        code={`export const VOID = "#0d0d0f";

export const CHARCOAL: Record<number, string> = {
  900: "#1a1a1f",
  800: "#222228",
  700: "#2a2a32",
  600: "#333340",
  500: "#3d3d48",
};

export const AMBER: Record<number, string> = {
  500: "#d4911e",
  400: "#f5a623",
  300: "#f7b84d",
  200: "#fcd88e",
  100: "#fde8b5",
  50: "#fef7e6",
};

export const CREAM = "#faf7f2";
export const CREAM_MUTED = "#a8a4a0";
export const CREAM_DIM = "#706c68";`}
      />

      <p>
        Three typefaces reinforce the cinematic feel:{" "}
        <strong>Instrument Serif</strong> for movie titles and the
        transcript strip, <strong>DM Sans</strong> for body text and
        labels, and <strong>DM Mono</strong> for metadata like years,
        runtimes, and rating numbers.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>14. Run it</h2>

      <CodeBlock
        filename="terminal"
        language="bash"
        code={`# From the monorepo root
pnpm install

# Set environment variables in examples/lola/.env.local:
#   OPENROUTER_API_KEY=...
#   TMDB_API_KEY=...
#   ELEVENLABS_API_KEY=...

pnpm --filter glove-lola run dev`}
      />

      <p>Try these conversations:</p>

      <ul>
        <li>
          <strong>&ldquo;Tell me about Inception&rdquo;</strong> &mdash;
          a poster grid appears, then the LLM narrates the results. Ask
          &ldquo;more details on that one&rdquo; and the full info card
          replaces the grid.
        </li>
        <li>
          <strong>&ldquo;Show me the trailer&rdquo;</strong> &mdash; a
          YouTube embed appears in the visual area. Lola says
          &ldquo;Here&apos;s the trailer &mdash; take a look.&rdquo;
        </li>
        <li>
          <strong>&ldquo;Compare it with Interstellar&rdquo;</strong>{" "}
          &mdash; side-by-side comparison cards appear. Lola highlights
          the key differences verbally.
        </li>
        <li>
          <strong>&ldquo;Cozy rainy day movies&rdquo;</strong> &mdash;
          mood-based discovery. Lola uses <code>get_recommendations</code>{" "}
          with the mood string, which maps to genre IDs internally.
        </li>
        <li>
          <strong>&ldquo;Who directed Parasite?&rdquo;</strong> &mdash;
          a person profile card appears for Bong Joon-ho with his
          notable films. Lola mentions his other work verbally.
        </li>
        <li>
          <strong>&ldquo;Where can I watch it?&rdquo;</strong> &mdash;
          streaming provider badges appear grouped by type (stream,
          rent, buy). Lola tells you the options out loud.
        </li>
      </ul>

      <p>
        Notice that throughout the conversation, you never need to tap
        the screen. The visual cards are ambient &mdash; they appear and
        stay visible while Lola narrates. The voice orb communicates
        state through animation. The text input is hidden by default
        and only appears when you tap the keyboard icon.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h2>Where each piece runs</h2>

      <table className="pattern-table">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Where</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>createChatHandler</code></td>
            <td>Server</td>
            <td>LLM proxy &mdash; sends tool schemas, streams responses</td>
          </tr>
          <tr>
            <td>Tool <code>do</code> functions</td>
            <td>Browser</td>
            <td>Fetch from TMDB proxy, fire visual cards, return text for narration</td>
          </tr>
          <tr>
            <td><code>/api/tmdb/[...path]</code></td>
            <td>Server</td>
            <td>TMDB proxy &mdash; keeps API key server-side</td>
          </tr>
          <tr>
            <td><code>/api/voice/stt-token</code></td>
            <td>Server</td>
            <td>Generates ElevenLabs STT tokens</td>
          </tr>
          <tr>
            <td><code>/api/voice/tts-token</code></td>
            <td>Server</td>
            <td>Generates ElevenLabs TTS tokens</td>
          </tr>
          <tr>
            <td>ElevenLabs STT/TTS</td>
            <td>Browser (direct connection)</td>
            <td>Browser uses tokens to stream audio directly to ElevenLabs</td>
          </tr>
          <tr>
            <td>Silero VAD</td>
            <td>Browser (WebAssembly)</td>
            <td>Runs a small neural network locally for speech detection</td>
          </tr>
          <tr>
            <td>Visual area, orb, transcript strip</td>
            <td>Browser</td>
            <td>UI components rendering tool output and voice state</td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------------------ */}
      <h2>Next steps</h2>

      <ul>
        <li>
          <a href="/docs/showcase/coffee-shop">Build a Coffee Shop</a>{" "}
          &mdash; see voice-enabled (text primary, voice secondary) for
          comparison with voice-first
        </li>
        <li>
          <a href="/docs/voice">Voice Integration</a> &mdash; deep dive
          into <code>useGloveVoice</code>, adapters, VAD, turn modes,
          and token routes
        </li>
        <li>
          <a href="/docs/display-stack">The Display Stack</a> &mdash;{" "}
          <code>pushAndWait</code> vs. <code>pushAndForget</code> and
          display strategies
        </li>
        <li>
          <a href="/docs/showcase/ecommerce-store">Build a Shopping Assistant</a>{" "}
          &mdash; see <code>pushAndWait</code> for interactive forms
          (the opposite of Lola&apos;s approach)
        </li>
        <li>
          <a href="/docs/showcase/coding-agent">Build a Coding Agent</a>{" "}
          &mdash; gate-execute-display pattern for server mutations
        </li>
        <li>
          <a href="/docs/react#define-tool"><code>defineTool</code> API Reference</a>{" "}
          &mdash; full API for typed tool definitions with{" "}
          <code>displayPropsSchema</code> and <code>resolveSchema</code>
        </li>
        <li>
          <a href="/docs/react">React API Reference</a> &mdash; full API
          documentation for <code>useGlove</code>,{" "}
          <code>GloveClient</code>, and rendering
        </li>
      </ul>
    </div>
  );
}
