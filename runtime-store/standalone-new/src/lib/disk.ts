/**
 * v91 — disk helpers (moved out of the deleted Google Drive lib so the
 * Firebase vault owns all cloud storage now).
 */
import fs from 'fs'

/** Local free disk in MB (never throws — unknowable behaves as "plenty"). */
export function localFreeMb(): number {
  try {
    const s = fs.statfsSync('/')
    return Math.floor((s.bavail * s.bsize) / (1024 * 1024))
  } catch { return 4096 }
}

/** Below this the vault hook drops the local artifact copy after upload. */
export const CRITICAL_DISK_MB = 600
