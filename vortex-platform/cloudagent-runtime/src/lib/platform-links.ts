/**
 * v151 — VORTEX ECOSYSTEM internal navigation.
 * The four modules are ONE platform (Vortex Platform): Cloud Agent (:3000),
 * VORTEX Server (:3200), the public Vortex Website (served by Cloud Agent at
 * /sites/vortex-website) and APPVERSE (Applications module inside the Server).
 * Ports are derived from the current origin (3000 <-> 3200 swap) so the links
 * work in this sandbox and on any host that keeps the two ports side by side.
 */

export const WEBSITE_PATH = "/sites/vortex-website";
export const APPVERSE_PATH = "/?view=apps"; // deep-link handled by the Server dashboard

export function cloudAgentOrigin(): string {
  if (typeof window === "undefined") return "";
  const { protocol, hostname, port } = window.location;
  const p = port || (protocol === "https:" ? "443" : "80");
  // Cloud Agent is :3000; when called FROM the Server (:3200) swap back.
  return `${protocol}//${hostname}:${p === "3200" ? "3000" : p}`;
}

export function vortexServerOrigin(): string {
  if (typeof window === "undefined") return "";
  const { protocol, hostname, port } = window.location;
  const p = port || (protocol === "https:" ? "443" : "80");
  // VORTEX Server is :3200; when called FROM Cloud Agent (:3000) swap across.
  return `${protocol}//${hostname}:${p === "3000" ? "3200" : p}`;
}

export function platformLinks() {
  return {
    website: `${cloudAgentOrigin()}${WEBSITE_PATH}`,
    server: vortexServerOrigin(),
    appverse: `${vortexServerOrigin()}${APPVERSE_PATH}`,
    agent: cloudAgentOrigin(),
  };
}
