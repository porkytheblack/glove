// Room allocation.
//
// The browser never talks to station — it asks this route for a room and gets
// back a WebSocket URL. The API key, station's address and the mesh token all
// stay server-side.
//
// A room is a long-lived signal run, so allocation is just `trigger` and
// hang-up is `cancel` — both on station's v1 API, both authenticated with the
// key alone.
//
// The one piece station cannot decide for us is the PORT. Signal runs are
// unbounded — there are no named slots to derive one from — so this route
// assigns one.
//
// It reads the ports already spoken for out of station's own run records
// (`input.port` on every pending/running `room` run) rather than probing the
// ports themselves. Probing alone is racy in the obvious way: a room takes
// seconds to boot, so two claims arriving in that window both see the port
// unanswered and both take it. Asking station what is allocated closes that
// window, because the run exists the moment the trigger returns.

import { NextResponse } from "next/server";
import { stationV1, StationAuthError, STATION_URL } from "../../lib/station";

const ROOM_SLOTS = Number(process.env.ROOM_SLOTS ?? 4);
const BASE_PORT = Number(process.env.ROOM_BASE_PORT ?? 4500);
const MESH_TOKEN = process.env.MESH_TOKEN ?? "dev-token";
/** What the BROWSER uses to reach a room — split from the bind port so this
 *  works behind a proxy without changing the room. */
const ROOM_HOST = process.env.NEXT_PUBLIC_ROOM_HOST ?? "localhost";

/** A run that has not reached a terminal status still owns its port. */
const LIVE = new Set(["pending", "running"]);

/** Ports currently spoken for, straight from station's run records. */
async function allocatedPorts(): Promise<Set<number>> {
  const res = await stationV1("/runs?signalName=room&limit=100");
  if (!res.ok) throw new Error(`station returned ${res.status} listing rooms`);
  const { data } = (await res.json()) as {
    data?: Array<{ status: string; input?: string | { port?: number } }>;
  };
  const taken = new Set<number>();
  for (const run of data ?? []) {
    if (!LIVE.has(run.status)) continue;
    try {
      const input =
        typeof run.input === "string"
          ? (JSON.parse(run.input) as { port?: number })
          : (run.input ?? {});
      if (typeof input.port === "number") taken.add(input.port);
    } catch {
      /* unreadable input — cannot claim its port, so skip it */
    }
  }
  return taken;
}

async function firstFreePort(): Promise<number | null> {
  const taken = await allocatedPorts();
  for (let slot = 1; slot <= ROOM_SLOTS; slot++) {
    const port = BASE_PORT + slot;
    if (!taken.has(port)) return port;
  }
  return null;
}

export async function POST(): Promise<NextResponse> {
  try {
    const port = await firstFreePort();
    if (port === null) {
      return NextResponse.json(
        { error: `All ${ROOM_SLOTS} rooms are in use. Hang up somewhere, or raise ROOM_SLOTS.` },
        { status: 503 },
      );
    }

    const roomId = `room-${port}-${Date.now().toString(36)}`;
    const res = await stationV1("/trigger", {
      method: "POST",
      body: JSON.stringify({
        signalName: "room",
        input: { roomId, port, meshToken: MESH_TOKEN },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `station refused to start the room: ${detail}` },
        { status: 502 },
      );
    }

    const { data } = (await res.json()) as { data: { id: string } };

    // The run has to be picked up by the runner, spawn, load the endpointing
    // model and bind — so the client polls /health rather than us blocking here.
    return NextResponse.json({
      runId: data.id,
      roomId,
      wsUrl: `ws://${ROOM_HOST}:${port}`,
      healthUrl: `http://${ROOM_HOST}:${port}/health`,
    });
  } catch (err) {
    if (err instanceof StationAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: `Could not reach station at ${STATION_URL}. Is it running? (pnpm start in examples/server-voice) — ${(err as Error).message}`,
      },
      { status: 503 },
    );
  }
}

/** Hang up: cancel the run, which SIGTERMs the room so it closes gracefully. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "pass ?runId=…" }, { status: 400 });
  try {
    const res = await stationV1(`/runs/${runId}/cancel`, { method: "POST" });
    return NextResponse.json({ stopped: res.ok });
  } catch (err) {
    if (err instanceof StationAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }
}
