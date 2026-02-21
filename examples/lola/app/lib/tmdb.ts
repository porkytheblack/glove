// ─── TMDB API client (browser-safe, proxied through /api/tmdb) ──────────────

const API_BASE = "/api/tmdb";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TMDBMovie {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  vote_average: number;
  vote_count: number;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  runtime?: number;
  tagline?: string;
  budget?: number;
  revenue?: number;
  status?: string;
  original_language?: string;
  popularity?: number;
  credits?: {
    cast: TMDBCastMember[];
    crew: TMDBCrewMember[];
  };
  videos?: {
    results: TMDBVideo[];
  };
  "watch/providers"?: {
    results: Record<string, TMDBProviderData>;
  };
}

export interface TMDBCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
  known_for_department: string;
}

export interface TMDBCrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
}

export interface TMDBVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface TMDBPerson {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  profile_path: string | null;
  known_for_department: string;
  combined_credits?: {
    cast: TMDBMovieCredit[];
    crew: TMDBMovieCredit[];
  };
}

export interface TMDBMovieCredit {
  id: number;
  title?: string;
  name?: string;
  media_type: string;
  character?: string;
  job?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  vote_count: number;
  poster_path: string | null;
  popularity: number;
}

export interface TMDBProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  display_priority: number;
}

export interface TMDBProviderData {
  link?: string;
  flatrate?: TMDBProvider[];
  rent?: TMDBProvider[];
  buy?: TMDBProvider[];
  ads?: TMDBProvider[];
}

// ─── Genre map ──────────────────────────────────────────────────────────────

export const GENRE_MAP: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

const GENRE_REVERSE: Record<string, number> = Object.fromEntries(
  Object.entries(GENRE_MAP).map(([id, name]) => [name.toLowerCase(), Number(id)]),
);

// ─── Image URL helpers ──────────────────────────────────────────────────────

export function posterUrl(path: string | null, size: "w92" | "w154" | "w185" | "w342" | "w500" | "w780" | "original" = "w342"): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function backdropUrl(path: string | null, size: "w300" | "w780" | "w1280" | "original" = "w780"): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function profileUrl(path: string | null, size: "w45" | "w185" | "h632" | "original" = "w185"): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function providerLogoUrl(path: string | null, size: "w45" | "w92" | "w154" | "w500" | "original" = "w45"): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function youtubeEmbedUrl(key: string): string {
  return `https://www.youtube.com/embed/${key}`;
}

export function youtubeThumbnailUrl(key: string): string {
  return `https://img.youtube.com/vi/${key}/hqdefault.jpg`;
}

// ─── Internal fetch helper ──────────────────────────────────────────────────

async function tmdbFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}/${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "Unknown error");
    throw new Error(`TMDB API error (${res.status}): ${errorBody}`);
  }
  return res.json() as Promise<T>;
}

// ─── API functions ──────────────────────────────────────────────────────────

export async function searchMovies(query: string, year?: number): Promise<TMDBMovie[]> {
  const params: Record<string, string> = { query };
  if (year) params.year = String(year);
  const data = await tmdbFetch<{ results: TMDBMovie[] }>("search/movie", params);
  return data.results;
}

export async function getMovieDetails(movieId: number): Promise<TMDBMovie> {
  return tmdbFetch<TMDBMovie>(`movie/${movieId}`, {
    append_to_response: "credits,videos,watch/providers",
  });
}

export async function getMovieRecommendations(movieId: number): Promise<TMDBMovie[]> {
  const data = await tmdbFetch<{ results: TMDBMovie[] }>(`movie/${movieId}/recommendations`);
  return data.results;
}

export async function discoverMovies(options?: {
  genreIds?: number[];
  sortBy?: string;
  year?: number;
  minRating?: number;
}): Promise<TMDBMovie[]> {
  const params: Record<string, string> = {
    sort_by: options?.sortBy ?? "popularity.desc",
  };
  if (options?.genreIds?.length) {
    params.with_genres = options.genreIds.join(",");
  }
  if (options?.year) {
    params.primary_release_year = String(options.year);
  }
  if (options?.minRating) {
    params["vote_average.gte"] = String(options.minRating);
  }
  const data = await tmdbFetch<{ results: TMDBMovie[] }>("discover/movie", params);
  return data.results;
}

export async function searchPerson(name: string): Promise<TMDBPerson[]> {
  const data = await tmdbFetch<{ results: TMDBPerson[] }>("search/person", { query: name });
  return data.results;
}

export async function getPersonDetails(personId: number): Promise<TMDBPerson> {
  return tmdbFetch<TMDBPerson>(`person/${personId}`, {
    append_to_response: "combined_credits",
  });
}

// ─── Mood-to-genre mapping ──────────────────────────────────────────────────

const MOOD_GENRE_MAP: Record<string, number[]> = {
  "feel-good": [35, 10751],
  "happy": [35, 10751],
  "funny": [35],
  "comedy": [35],
  "romantic": [10749],
  "love": [10749, 18],
  "scary": [27],
  "horror": [27],
  "creepy": [27, 53],
  "thrilling": [53],
  "suspense": [53, 9648],
  "action": [28],
  "adventure": [12],
  "epic": [12, 14],
  "fantasy": [14],
  "sci-fi": [878],
  "science fiction": [878],
  "dramatic": [18],
  "drama": [18],
  "sad": [18],
  "emotional": [18, 10749],
  "dark": [80, 53],
  "crime": [80],
  "mystery": [9648],
  "animated": [16],
  "family": [10751],
  "kids": [16, 10751],
  "war": [10752],
  "historical": [36],
  "musical": [10402],
  "documentary": [99],
  "western": [37],
  "mind-bending": [878, 9648],
  "trippy": [878, 14],
  "uplifting": [35, 18],
  "inspiring": [18, 36],
  "nostalgic": [18, 10751],
  "intense": [28, 53],
  "lighthearted": [35, 10749],
  "chill": [35, 18],
  "relaxing": [35, 10749, 10402],
};

export function moodToGenreIds(mood: string): number[] {
  const lower = mood.toLowerCase();

  // Direct match
  if (MOOD_GENRE_MAP[lower]) return MOOD_GENRE_MAP[lower];

  // Check if any keyword appears in the mood string
  const matched = new Set<number>();
  for (const [keyword, ids] of Object.entries(MOOD_GENRE_MAP)) {
    if (lower.includes(keyword)) {
      for (const id of ids) matched.add(id);
    }
  }
  if (matched.size > 0) return Array.from(matched);

  // Check direct genre name match
  const genreId = GENRE_REVERSE[lower];
  if (genreId) return [genreId];

  // Fallback: popular movies across genres
  return [];
}

// ─── Utility helpers ────────────────────────────────────────────────────────

export function movieYear(movie: TMDBMovie): string {
  if (!movie.release_date) return "Unknown";
  return movie.release_date.substring(0, 4);
}

export function formatRuntime(minutes: number | undefined): string {
  if (!minutes) return "N/A";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function getDirector(movie: TMDBMovie): string {
  if (!movie.credits?.crew) return "Unknown";
  const director = movie.credits.crew.find((c) => c.job === "Director");
  return director?.name ?? "Unknown";
}

export function getTopCast(movie: TMDBMovie, count: number = 5): TMDBCastMember[] {
  if (!movie.credits?.cast) return [];
  return movie.credits.cast
    .sort((a, b) => a.order - b.order)
    .slice(0, count);
}

export function getTrailer(movie: TMDBMovie): TMDBVideo | null {
  if (!movie.videos?.results) return null;
  // Prefer official YouTube trailers
  const official = movie.videos.results.find(
    (v) => v.site === "YouTube" && v.type === "Trailer" && v.official,
  );
  if (official) return official;
  // Fall back to any YouTube trailer
  const anyTrailer = movie.videos.results.find(
    (v) => v.site === "YouTube" && v.type === "Trailer",
  );
  if (anyTrailer) return anyTrailer;
  // Fall back to any YouTube video (teaser, clip, etc.)
  return movie.videos.results.find((v) => v.site === "YouTube") ?? null;
}

export function getProviders(movie: TMDBMovie, country: string = "US"): TMDBProviderData | null {
  const providers = movie["watch/providers"]?.results;
  if (!providers) return null;
  return providers[country] ?? null;
}

export function genreNames(movie: TMDBMovie): string[] {
  if (movie.genres) return movie.genres.map((g) => g.name);
  if (movie.genre_ids) return movie.genre_ids.map((id) => GENRE_MAP[id] ?? "Unknown");
  return [];
}

export function truncateBio(text: string, sentences: number): string {
  if (!text) return "";
  const parts = text.split(/(?<=[.!?])\s+/);
  if (parts.length <= sentences) return text;
  return parts.slice(0, sentences).join(" ");
}
