import { NextResponse } from "next/server";

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

  const tmdbUrl = `${TMDB_API_BASE}/${path.join("/")}?${url.searchParams.toString()}`;

  const res = await fetch(tmdbUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
