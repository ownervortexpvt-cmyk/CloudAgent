import { NextResponse } from "next/server";

/**
 * GET /api — honest liveness payload (was the scaffold leftover
 * "Hello, world!"). Lock-guarded like every other non-public route.
 */
export async function GET() {
  return NextResponse.json({
    app: "Cloud Agent",
    status: "ok",
    lock: "required — unlock at /lock",
    time: new Date().toISOString(),
  });
}
