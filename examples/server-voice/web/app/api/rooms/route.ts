// Room allocation.
//
// The browser never talks to station directly — it asks this route for a room,
// and gets back a WebSocket URL. Everything about the control plane (which
// slots exist, station's address, the mesh token) stays server-side.
//
// Allocation is "find a slot that isn't running and start it". Station keys
// beacon instances by name, so the pool is a fixed set of registered slots
// (`room-1` … `room-N`); claiming one is a POST to station's beacon API with
// the config that room should run under.

import { NextResponse } from "next/server";

const STATION_URL = process.env.STATION_URL ?? "http://localhost:4400";
const ROOM_SLOTS = Number(process.env.ROOM_SLOTS ?? 4);
const BASE_PORT = Number(process.env.ROOM_BASE_PORT ?? 4500);
const MESH_TOKEN = process.env.MESH_TOKEN ?? "dev-token";
/** Where the browser reaches a room. Split from the internal port so this
 *  works behind a proxy without changing the room itself. */
const ROOM_HOST = process.env.NEXT_PUBLIC_ROOM_HOST ?? "localhost";

/** Station returns the registration, with the supervised instance nested under
 *  it — `status` and `desiredState` live on `instance`, not at the top level. */
interface BeaconRegistration {
  name: string;
  instance?: { status?: string; desiredState?: string } | null;
}

async function station(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${STATION_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
}

/** Which slots are currently occupied, per station. */
async function occupiedSlots(): Promise<Set<string>> {
  const res = await station("/beacons");
  if (!res.ok) throw new Error(`station returned ${res.status}`);
  const body = (await res.json()) as { data?: BeaconRegistration[] };
  const busy = new Set<string>();
  for (const b of body.data ?? []) {
    const inst = b.instance;
    if (!inst) continue;
    // A slot is taken if it is running, on its way there, or an operator has
    // asked for it to be running. `backoff` counts: it is mid-restart, and its
    // port is about to be claimed again.
    if (
      inst.desiredState === "running" ||
      ["running", "starting", "backoff", "stopping"].includes(inst.status ?? "")
    ) {
      busy.add(b.name);
    }
  }
  return busy;
}

export async function POST(): Promise<NextResponse> {
  let busy: Set<string>;
  try {
    busy = await occupiedSlots();
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not reach station at ${STATION_URL}. Is it running? (pnpm start in examples/server-voice) — ${(err as Error).message}`,
      },
      { status: 503 },
    );
  }

  const slot = Array.from({ length: ROOM_SLOTS }, (_, i) => i + 1).find(
    (n) => !busy.has(`room-${n}`),
  );
  if (!slot) {
    return NextResponse.json(
      { error: `All ${ROOM_SLOTS} rooms are in use. Hang up somewhere, or raise ROOM_SLOTS.` },
      { status: 503 },
    );
  }

  const name = `room-${slot}`;
  const port = BASE_PORT + slot;
  const roomId = `${name}-${Date.now().toString(36)}`;

  const res = await station(`/beacons/${name}/start`, {
    method: "POST",
    body: JSON.stringify({ config: { roomId, port, meshToken: MESH_TOKEN } }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: `station refused to start ${name}: ${detail}` }, { status: 502 });
  }

  // The room binds its port and loads the endpointing model before it reports
  // ready; the client polls /health rather than us blocking this request.
  return NextResponse.json({
    room: name,
    roomId,
    wsUrl: `ws://${ROOM_HOST}:${port}`,
    healthUrl: `http://${ROOM_HOST}:${port}/health`,
  });
}

/** Hang up: release the slot so the next caller can claim it. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("room");
  if (!name || !/^room-\d+$/.test(name)) {
    return NextResponse.json({ error: "pass ?room=room-N" }, { status: 400 });
  }
  const res = await station(`/beacons/${name}/stop`, { method: "POST" });
  return NextResponse.json({ stopped: res.ok });
}
