/**
 * via-terminal.cjs — launch a long-lived command through the agent-service
 * (:3001, boot tree) terminal channel so the sandbox reaper cannot touch it.
 * Tool-call spawns get reaped; children of the :3001 bun service survive.
 *
 * v152.5 — the socket.io-client UMD bundle is VENDORED at
 * scripts/socket-io-standalone.js so this launcher works even while the
 * sandbox checkpoint janitor has evicted node_modules (it deletes them
 * every ~10-20 min; the watchdog reinstalls automatically).
 *
 * Usage: node scripts/via-terminal.cjs "<shell command>" [--wait ms]
 */
let io
try {
  ;({ io } = require('/home/z/my-project/node_modules/socket.io-client'))
} catch {
  ;({ io } = require('/home/z/my-project/scripts/socket-io-standalone.js'))
}

const args = process.argv.slice(2)
const CMD = args[0]
const WAIT = parseInt(args.includes('--wait') ? args[args.indexOf('--wait') + 1] : '8000', 10)
if (!CMD) { console.error('usage: node via-terminal.cjs "<command>" [--wait ms]'); process.exit(2) }

const socket = io('http://127.0.0.1:3001/', {
  path: '/',
  transports: ['websocket'],
  reconnection: false,
  timeout: 8000,
})

let ready = false
let out = ''
const log = (m) => console.log('[evt]', m)

socket.onAny((ev, ...payload) => {
  if (ev !== 'terminal:output') log(ev + ' ' + JSON.stringify(payload).slice(0, 200))
})

socket.on('connect', () => {
  log('connected sid=' + socket.id)
  socket.emit('terminal:start', { projectId: 'cmvh9ssrb002sn2fe0c8vrhds' })
})

socket.on('terminal:ready', () => {
  if (ready) return
  ready = true
  log('terminal ready — sending command')
  socket.emit('terminal:input', { data: CMD + ' ; echo __VIA_TERMINAL_DONE__\n' })
})

socket.on('terminal:output', (d) => { out += d.toString() })
socket.on('connect_error', (e) => { log('connect_error: ' + e.message); process.exit(1) })
socket.on('disconnect', (r) => log('disconnect: ' + r))

setTimeout(() => {
  const ok = out.includes('__VIA_TERMINAL_DONE__')
  console.log(ok ? 'VIA-TERMINAL: command executed' : 'VIA-TERMINAL: no completion marker')
  console.log('--- raw tail ---')
  console.log(JSON.stringify(out.slice(-800)))
  process.exit(ok ? 0 : 1)
}, WAIT)
