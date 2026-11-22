/**
 * Project templates — seeded when user clicks "Create New App".
 * Each template writes a small set of starter files to the project.
 */

export interface TemplateDef {
  id: string
  name: string
  framework: string
  runtime: string
  description: string
  icon: string
  files: Array<{ path: string; content: string }>
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'static',
    name: 'Static HTML/CSS/JS',
    framework: 'static',
    runtime: 'static',
    description: 'Plain static web page — index.html + style.css + script.js.',
    icon: 'globe',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Static App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello from Cloud Agent</h1>
    <p id="count">Clicks: 0</p>
    <button id="btn">Click me</button>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
      },
      {
        path: 'style.css',
        content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
  display: grid;
  place-items: center;
}
main { text-align: center; }
h1 { font-size: 2.5rem; margin-bottom: 1rem; }
button {
  margin-top: 1rem;
  padding: 0.75rem 1.5rem;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 1rem;
  cursor: pointer;
}
button:hover { background: #334155; }
`,
      },
      {
        path: 'script.js',
        content: `let count = 0;
const btn = document.getElementById('btn');
const counter = document.getElementById('count');
btn.addEventListener('click', () => {
  count++;
  counter.textContent = \`Clicks: \${count}\`;
});
`,
      },
    ],
  },
  {
    id: 'next',
    name: 'Next.js (App Router)',
    framework: 'next',
    runtime: 'node',
    description: 'Minimal Next.js 14 app with TypeScript + Tailwind. Run with `next dev`.',
    icon: 'next',
    files: [
      {
        path: '.postcssrc.json',
        content: `{"plugins": {}}`,
      },
      {
        path: 'package.json',
        content: `{
  "name": "my-next-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p ${'$'}{PORT}",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "typescript": "^5"
  }
}
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "es2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`,
      },
      {
        path: 'next.config.js',
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};
module.exports = nextConfig;
`,
      },
      {
        path: 'src/app/page.tsx',
        content: `export default function Home() {
  return (
    <main style={{
      fontFamily: 'system-ui, sans-serif',
      background: '#0f172a',
      color: '#e2e8f0',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1rem',
    }}>
      <h1 style={{ fontSize: '2.5rem' }}>Hello from Cloud Agent</h1>
      <p style={{ color: '#94a3b8' }}>Edit src/app/page.tsx to get started</p>
    </main>
  );
}
`,
      },
      {
        path: 'src/app/layout.tsx',
        content: `import './globals.css';

export const metadata = { title: 'My Next App', description: 'Built with Cloud Agent' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      },
      {
        path: 'src/app/globals.css',
        content: `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body { background: #0f172a; color: #e2e8f0; }
`,
      },
    ],
  },
  {
    id: 'vite-react',
    name: 'Vite + React + TS',
    framework: 'vite',
    runtime: 'node',
    description: 'Vite + React + TypeScript starter. Lightning-fast HMR.',
    icon: 'vite',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "my-vite-app",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port ${'$'}{PORT} --host",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5",
    "vite": "^5.3.4"
  }
}
`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Vite App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: 'src/main.tsx',
        content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`,
      },
      {
        path: 'src/App.tsx',
        content: `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main style={{ fontFamily: 'system-ui', background: '#0f172a', color: '#e2e8f0', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <h1 style={{ fontSize: '2.5rem' }}>Cloud Agent + Vite</h1>
      <p>Clicks: {count}</p>
      <button onClick={() => setCount(c => c + 1)} style={{ padding: '0.5rem 1rem', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, cursor: 'pointer' }}>
        Increment
      </button>
    </main>
  )
}
`,
      },
      {
        path: 'src/index.css',
        content: `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }
body { background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; }
`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [] } },
  server: { host: true },
})
`,
      },
    ],
  },
  {
    id: 'node-express',
    name: 'Node.js + Express',
    framework: 'node',
    runtime: 'node',
    description: 'Express.js FULL-PRODUCT starter: user app + admin app + JSON API + database layer.',
    icon: 'node',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "my-express-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch index.js",
    "start": "node index.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
`,
      },
      {
        path: 'index.js',
        content: `import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { db } from './db.js'

const app = express()
const PORT = process.env.PORT || 3000
const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ---- REAL REST API (user app + admin app both call these) ----
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }))
app.get('/api/notes', (req, res) => res.json(db.data.notes))
app.post('/api/notes', (req, res) => {
  const { title, body } = req.body || {}
  if (!title) return res.status(400).json({ error: 'title required' })
  const note = { id: Date.now().toString(36), title, body: body || '', createdAt: Date.now() }
  db.data.notes.push(note)
  db.save()
  res.status(201).json(note)
})
app.delete('/api/notes/:id', (req, res) => {
  const i = db.data.notes.findIndex(n => n.id === req.params.id)
  if (i < 0) return res.status(404).json({ error: 'not found' })
  db.data.notes.splice(i, 1)
  db.save()
  res.json({ ok: true })
})
// admin stats endpoint (role check demo — replace with real auth)
app.get('/api/admin/stats', (req, res) => {
  res.json({ notes: db.data.notes.length, users: db.data.users.length, uptime: process.uptime() })
})

app.listen(PORT, () => console.log('Server on http://localhost:' + PORT))
`,
      },
      {
        path: 'db.js',
        content: `// DATABASE LAYER — JSON-file persistence. Data SURVIVES restarts.
// Swap for SQLite/Prisma later; the API stays the same (db.data.<entity>, db.save()).
import fs from 'fs'

const FILE = process.env.DB_FILE || 'data/db.json'

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return {
      users: [{ id: 'u1', email: 'admin@local', role: 'admin', password: 'changeme' }],
      notes: [],
    }
  }
}

export const db = {
  data: load(),
  save() {
    fs.mkdirSync(FILE.split('/').slice(0, -1).join('/'), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(this.data, null, 2))
  },
}
`,
      },
      {
        path: 'public/index.html',
        content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Notes — User App</title>
  <style>
    * { box-sizing: border-box } body { font-family: system-ui; margin: 0; background: #f6f7fb; color: #17202e }
    header { background: #fff; border-bottom: 1px solid #e5e8f0; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center }
    main { max-width: 640px; margin: 24px auto; padding: 0 16px }
    .card { background: #fff; border: 1px solid #e5e8f0; border-radius: 12px; padding: 16px; margin-bottom: 12px }
    input, textarea { width: 100%; padding: 10px; border: 1px solid #d7dbe6; border-radius: 8px; margin-bottom: 8px; font: inherit }
    button { background: #3554d1; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; cursor: pointer; font: inherit }
    .del { background: #d13535; padding: 6px 10px }
    .empty { color: #667085; text-align: center; padding: 32px 0 }
  </style>
</head>
<body>
  <header><strong>🗒️ Notes</strong><a href="/admin.html">Admin</a></header>
  <main>
    <div class="card">
      <input id="title" placeholder="Note title" />
      <textarea id="body" rows="2" placeholder="Write something…"></textarea>
      <button onclick="addNote()">Add note</button>
    </div>
    <div id="list"></div>
  </main>
  <script>
    async function loadNotes() {
      const notes = await fetch('/api/notes').then(r => r.json())
      const el = document.getElementById('list')
      el.innerHTML = notes.length ? notes.map(n =>
        '<div class="card"><strong>' + n.title + '</strong><p>' + (n.body || '') + '</p>' +
        '<button class="del" onclick="del(\\'' + n.id + '\\')">Delete</button></div>').join('')
        : '<p class="empty">No notes yet.</p>'
    }
    async function addNote() {
      const title = document.getElementById('title').value.trim()
      const body = document.getElementById('body').value.trim()
      if (!title) return alert('Title required')
      await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, body }) })
      document.getElementById('title').value = ''
      document.getElementById('body').value = ''
      loadNotes()
    }
    async function del(id) { await fetch('/api/notes/' + id, { method: 'DELETE' }); loadNotes() }
    loadNotes()
  </script>
</body>
</html>
`,
      },
      {
        path: 'public/admin.html',
        content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin — Dashboard</title>
  <style>
    * { box-sizing: border-box } body { font-family: system-ui; margin: 0; background: #101426; color: #eef1fa }
    header { background: #171d36; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center }
    main { max-width: 860px; margin: 24px auto; padding: 0 16px }
    .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px }
    .stat { background: #1b2340; border-radius: 12px; padding: 16px 24px; min-width: 140px }
    .stat b { display: block; font-size: 26px; color: #7ea2ff }
    table { width: 100%; border-collapse: collapse; background: #171d36; border-radius: 12px; overflow: hidden }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #232c50 }
    th { color: #9aa7d0; font-size: 12px; text-transform: uppercase }
  </style>
</head>
<body>
  <header><strong>🛠 Admin</strong><a href="/" style="color:#7ea2ff">User app</a></header>
  <main>
    <div class="stats">
      <div class="stat"><b id="s-notes">—</b>Notes</div>
      <div class="stat"><b id="s-users">—</b>Users</div>
      <div class="stat"><b id="s-uptime">—</b>Uptime (s)</div>
    </div>
    <table>
      <thead><tr><th>ID</th><th>Title</th><th>Created</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </main>
  <script>
    async function load() {
      const s = await fetch('/api/admin/stats').then(r => r.json())
      document.getElementById('s-notes').textContent = s.notes
      document.getElementById('s-users').textContent = s.users
      document.getElementById('s-uptime').textContent = Math.round(s.uptime)
      const notes = await fetch('/api/notes').then(r => r.json())
      document.getElementById('rows').innerHTML = notes.map(n =>
        '<tr><td>' + n.id + '</td><td>' + n.title + '</td><td>' + new Date(n.createdAt).toLocaleString() + '</td>' +
        '<td><button onclick="del(\\'' + n.id + '\\')">Delete</button></td></tr>').join('')
    }
    async function del(id) { await fetch('/api/notes/' + id, { method: 'DELETE' }); load() }
    load(); setInterval(load, 5000)
  </script>
</body>
</html>
`,
      },
      {
        path: 'README.md',
        content: `# My Express App (FULL PRODUCT starter)

Four parts, one command:

- **User app** — \`public/index.html\` (served at \`/\`)
- **Admin app** — \`public/admin.html\` (served at \`/admin.html\`, seed login: admin@local / changeme)
- **Backend server** — \`index.js\` (Express REST API)
- **Database** — \`db.js\` (JSON-file store at \`data/db.json\`, survives restarts)

## Run

\`\`\`bash
npm install
npm run dev        # http://localhost:3000
\`\`\`

## API

| Method | Path | What |
|--------|------|------|
| GET | /api/health | health probe |
| GET | /api/notes | list notes |
| POST | /api/notes | create note \`{title, body}\` |
| DELETE | /api/notes/:id | delete note |
| GET | /api/admin/stats | admin dashboard stats |

The agent should extend every part — more entities, auth, real admin CRUD — keeping the user app, admin app and server wired to the same database.
`,
      },
    ],
  },
  {
    id: 'python-fastapi',
    name: 'Python + FastAPI',
    framework: 'python',
    runtime: 'python',
    description: 'FastAPI server with uvicorn. Requires Python installed.',
    icon: 'python',
    files: [
      {
        path: 'requirements.txt',
        content: `fastapi==0.111.0
uvicorn[standard]==0.30.1
`,
      },
      {
        path: 'main.py',
        content: `from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI()

@app.get("/", response_class=HTMLResponse)
def root():
    return "<h1>Hello from Cloud Agent</h1><p>FastAPI + uvicorn</p>"

@app.get("/api/health")
def health():
    return {"ok": True, "time": __import__("time").time()}
`,
      },
    ],
  },
  {
    id: 'flutter-web',
    name: 'Flutter Web',
    framework: 'flutter',
    runtime: 'flutter',
    description: 'Flutter counter app for the web. Requires Flutter SDK.',
    icon: 'flutter',
    files: [
      {
        path: 'pubspec.yaml',
        content: `name: my_flutter_app
description: A new Flutter project built with Cloud Agent.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter

dev_dependencies:
  flutter_test:
    sdk: flutter

flutter:
  uses-material-design: true
`,
      },
      {
        path: 'lib/main.dart',
        content: `import 'package:flutter/material.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Cloud Agent Flutter',
      theme: ThemeData.dark(useMaterial3: true),
      home: const CounterPage(),
    );
  }
}

class CounterPage extends StatefulWidget {
  const CounterPage({super.key});

  @override
  State<CounterPage> createState() => _CounterPageState();
}

class _CounterPageState extends State<CounterPage> {
  int _count = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Cloud Agent')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('You have pushed the button this many times:'),
            Text('\$_count', style: Theme.of(context).textTheme.headlineMedium),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => setState(() => _count++),
        child: const Icon(Icons.add),
      ),
    );
  }
}
`,
      },
    ],
  },
  {
    id: 'vue',
    name: 'Vue 3 + Vite',
    framework: 'vite',
    runtime: 'node',
    description: 'Vue 3 SFC starter with Vite. Composition API.',
    icon: 'vue',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "my-vue-app",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port \${'$'}{PORT} --host",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "typescript": "^5",
    "vite": "^5.3.0"
  }
}
`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Vue App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
      },
      {
        path: 'src/main.ts',
        content: `import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')
`,
      },
      {
        path: 'src/App.vue',
        content: `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <main>
    <h1>Cloud Agent + Vue 3</h1>
    <p>Clicks: {{ count }}</p>
    <button @click="count++">Increment</button>
  </main>
</template>

<style scoped>
main {
  font-family: system-ui, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}
button {
  padding: 0.5rem 1rem;
  background: #1e293b;
  color: #e2e8f0;
  border: 1px solid #334155;
  border-radius: 8px;
  cursor: pointer;
}
</style>
`,
      },
      {
        path: 'src/style.css',
        content: `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #app { height: 100%; }
body { background: #0f172a; color: #e2e8f0; }
`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  css: { postcss: { plugins: [] } },
  server: { host: true },
})
`,
      },
    ],
  },
  {
    id: 'svelte',
    name: 'Svelte + Vite',
    framework: 'vite',
    runtime: 'node',
    description: 'Svelte 5 starter with Vite. Compiled, fast.',
    icon: 'svelte',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "my-svelte-app",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port \${'$'}{PORT} --host",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.1.0",
    "svelte": "^4.2.0",
    "vite": "^5.3.0"
  }
}
`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Svelte App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
      },
      {
        path: 'src/main.ts',
        content: `import './app.css'
import App from './App.svelte'

const app = new App({
  target: document.getElementById('app')!,
})

export default app
`,
      },
      {
        path: 'src/App.svelte',
        content: `<script>
  let count = 0;
</script>

<main>
  <h1>Cloud Agent + Svelte</h1>
  <p>Clicks: {count}</p>
  <button on:click={() => count++}>Increment</button>
</main>

<style>
  main {
    font-family: system-ui, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }
  button {
    padding: 0.5rem 1rem;
    background: #1e293b;
    color: #e2e8f0;
    border: 1px solid #334155;
    border-radius: 8px;
    cursor: pointer;
  }
</style>
`,
      },
      {
        path: 'src/app.css',
        content: `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #app { height: 100%; }
body { background: #0f172a; color: #e2e8f0; }
`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  css: { postcss: { plugins: [] } },
  server: { host: true },
})
`,
      },
    ],
  },
  {
    id: 'go-api',
    name: 'Go + net/http API',
    framework: 'node',
    runtime: 'node',
    description: 'Go HTTP server with JSON endpoints. Requires Go installed.',
    icon: 'go',
    files: [
      {
        path: 'go.mod',
        content: `module my-go-app

go 1.21
`,
      },
      {
        path: 'main.go',
        content: `package main

import (
        "encoding/json"
        "fmt"
        "net/http"
        "os"
)

func main() {
        port := os.Getenv("PORT")
        if port == "" {
                port = "3000"
        }

        http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
                w.Header().Set("Content-Type", "text/html")
                fmt.Fprintf(w, "<h1>Hello from Cloud Agent</h1><p>Go server running.</p>")
        })

        http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
                w.Header().Set("Content-Type", "application/json")
                json.NewEncoder(w).Encode(map[string]any{"ok": true})
        })

        fmt.Println("Server on http://localhost:" + port)
        http.ListenAndServe(":"+port, nil)
}
`,
      },
      {
        path: 'README.md',
        content: `# My Go App

Built with Cloud Agent.

## Run
\`\`\`bash
go run main.go
\`\`\`

The server starts on the port specified by the PORT env var (default 3000).
`,
      },
    ],
  },
  {
    id: 'rust-axum',
    name: 'Rust + Axum API',
    framework: 'node',
    runtime: 'node',
    description: 'Rust HTTP server with Axum. Requires Rust + Cargo installed.',
    icon: 'rust',
    files: [
      {
        path: 'Cargo.toml',
        content: `[package]
name = "my-rust-app"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde_json = "1"
`,
      },
      {
        path: 'src/main.rs',
        content: `use axum::{routing::get, Router, Json};
use std::env;

#[tokio::main]
async fn main() {
    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);

    let app = Router::new()
        .route("/", get(root))
        .route("/api/health", get(health));

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("Server on http://{}", addr);
    axum::serve(listener, app).await.unwrap();
}

async fn root() -> String {
    "<h1>Hello from Cloud Agent</h1><p>Rust server running.</p>".to_string()
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}
`,
      },
    ],
  },
  {
    id: 'capacitor',
    name: 'Capacitor (Web → Android/iOS)',
    framework: 'vite',
    runtime: 'node',
    description: 'Vite + React + Capacitor. Web app that can be wrapped into a native Android/iOS app.',
    icon: 'capacitor',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "my-capacitor-app",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port \${'$'}{PORT} --host",
    "build": "vite build",
    "preview": "vite preview",
    "cap:sync": "npm run build && cap sync",
    "cap:open:android": "cap open android",
    "cap:open:ios": "cap open ios"
  },
  "dependencies": {
    "@capacitor/core": "^6.0.0",
    "@capacitor/android": "^6.0.0",
    "@capacitor/ios": "^6.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.0.0",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5",
    "vite": "^5.3.4"
  }
}
`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>My Capacitor App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: 'src/main.tsx',
        content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`,
      },
      {
        path: 'src/App.tsx',
        content: `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main style={{ fontFamily: 'system-ui', background: '#0f172a', color: '#e2e8f0', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 16, paddingTop: 'env(safe-area-inset-top)' }}>
      <h1 style={{ fontSize: '2rem' }}>Cloud Agent + Capacitor</h1>
      <p>This web app can be wrapped as a native Android/iOS app via Capacitor.</p>
      <p>Clicks: {count}</p>
      <button onClick={() => setCount(c => c + 1)} style={{ padding: '0.75rem 1.5rem', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, cursor: 'pointer' }}>
        Increment
      </button>
    </main>
  )
}
`,
      },
      {
        path: 'src/index.css',
        content: `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }
body { background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; }
`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [] } },
  server: { host: true },
})
`,
      },
      {
        path: 'capacitor.config.ts',
        content: `import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.example.myapp',
  appName: 'My Capacitor App',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
`,
      },
      {
        path: 'README.md',
        content: `# My Capacitor App

Built with Cloud Agent. This is a Vite + React app that can be wrapped as a native Android/iOS app using Capacitor.

## Run as web app
\`\`\`bash
npm run dev
\`\`\`

## Wrap as native Android app
1. \`npm install\`
2. \`npm run build\`
3. \`npx cap add android\`
4. \`npx cap sync\`
5. \`npx cap open android\` — opens Android Studio
6. Build → Generate Signed APK

## Wrap as native iOS app
1. \`npm install\`
2. \`npm run build\`
3. \`npx cap add ios\`
4. \`npx cap sync\`
5. \`npx cap open ios\` — opens Xcode (macOS only)
`,
      },
    ],
  },
  {
    id: 'csharp-game',
    name: 'C# Web Game: Snake (ASP.NET 8)',
    framework: 'dotnet',
    runtime: 'dotnet',
    description: 'Real playable Snake game — the game loop, collision, scoring and high-score file run in pure C# (.NET 8, zero external packages); the browser draws the board. Plays right in the preview.',
    icon: 'gamepad',
    files: [
      {
        path: 'SnakeWeb.csproj',
        content: `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>SnakeWeb</RootNamespace>
  </PropertyGroup>
</Project>
`,
      },
      {
        path: 'Program.cs',
        content: `// Snake Web (Cloud Agent C# starter) — REAL game logic in pure C# / .NET 8.
// ASP.NET Core is built into .NET 8, so there are ZERO external packages.
// The C# engine owns the game loop, collision, growth, scoring and the
// high-score file; wwwroot/index.html draws the board and sends steering.
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.UseStaticFiles();

const int W = 32, H = 16;
var rand = new Random();
var gate = new object();
var snake = new List<(int x, int y)> { (W / 2, H / 2) };
var dir = (dx: 1, dy: 0);
var queued = dir;
var food = (x: 0, y: 0);
int score = 0, high = 0, speed = 220;
bool over = false;
try { high = int.Parse(File.ReadAllText("highscore.txt")); } catch { }
void PlaceFood() { do { food = (rand.Next(0, W), rand.Next(0, H)); } while (snake.Contains(food)); }
PlaceFood();

// THE GAME LOOP — a real C# engine tick: move, collide, grow, speed up.
new Thread(() => {
  while (true) {
    Thread.Sleep(speed);
    lock (gate) {
      if (over) continue;
      dir = queued;
      var head = snake[0];
      var next = (x: (head.x + dir.dx + W) % W, y: (head.y + dir.dy + H) % H);
      if (snake.Contains(next)) {
        over = true;
        if (score > high) { high = score; File.WriteAllText("highscore.txt", high.ToString()); }
        continue;
      }
      snake.Insert(0, next);
      if (next == food) {
        score += 10;
        if (snake.Count % 4 == 0 && speed > 90) speed -= 15;   // faster as you grow
        PlaceFood();
      } else snake.RemoveAt(snake.Count - 1);
    }
  }
}) { IsBackground = true }.Start();

app.MapGet("/api/state", () => {
  lock (gate) {
    return Results.Json(new {
      w = W, h = H, over, score, high, speed,
      snake = snake.Select(p => new[] { p.x, p.y }),
      food = new[] { food.x, food.y },
    });
  }
});
app.MapPost("/api/steer", (JsonElement body) => {
  int dx = body.GetProperty("dx").GetInt32(), dy = body.GetProperty("dy").GetInt32();
  lock (gate) { if (!over && !(dx == -dir.dx && dy == -dir.dy)) queued = (dx, dy); }
  return Results.Json(new { ok = true });
});
app.MapPost("/api/new", () => {
  lock (gate) {
    snake.Clear(); snake.Add((W / 2, H / 2));
    dir = queued = (1, 0);
    score = 0; speed = 220; over = false; PlaceFood();
  }
  return Results.Json(new { ok = true });
});

app.Run();
`,
      },
      {
        path: 'wwwroot/index.html',
        content: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Snake — C# / ASP.NET 8</title><style>
body{background:#0f172a;color:#e2e8f0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px}
canvas{background:#111827;border:2px solid #334155;border-radius:8px}
.hud{display:flex;gap:18px;font-size:14px;opacity:.9;align-items:center}
button{background:#1d4ed8;color:#fff;border:0;border-radius:6px;padding:6px 14px;cursor:pointer}
</style></head><body>
<h2 style="margin:0">Snake — the engine is real C# (ASP.NET 8)</h2>
<div class="hud"><span id="score">Score 0</span><span id="high">High 0</span><button onclick="fetch('/api/new',{method:'POST'}).then(poll)">New game</button></div>
<canvas id="c" width="640" height="320"></canvas>
<p style="opacity:.7;font-size:13px;margin:0">Arrow keys / WASD to steer — game loop, collision and scoring run server-side in C#.</p>
<script>
var cv=document.getElementById('c'),ctx=cv.getContext('2d');
function draw(s){ctx.clearRect(0,0,640,320);var cw=640/s.w,ch=320/s.h;
 ctx.fillStyle='#22c55e';for(var i=0;i<s.snake.length;i++){var p=s.snake[i];ctx.fillRect(p[0]*cw+1,p[1]*ch+1,cw-2,ch-2);}
 ctx.fillStyle='#ef4444';ctx.fillRect(s.food[0]*cw+2,s.food[1]*ch+2,cw-4,ch-4);
 document.getElementById('score').textContent='Score '+s.score;
 document.getElementById('high').textContent='High '+s.high;
 if(s.over){ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(0,0,640,320);ctx.fillStyle='#fff';ctx.font='bold 28px system-ui';ctx.textAlign='center';ctx.fillText('GAME OVER — '+s.score,320,160);}}
function poll(){fetch('/api/state').then(function(r){return r.json()}).then(draw).catch(function(){});}
addEventListener('keydown',function(e){
 var m={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]};
 var k=(e.key.length===1)?e.key.toLowerCase():e.key;
 var d=m[k];
 if(d){e.preventDefault();fetch('/api/steer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dx:d[0],dy:d[1]})});}});
poll();setInterval(poll,120);
</script></body></html>
`,
      },
      {
        path: 'README.md',
        content: `# C# Snake Web Game (ASP.NET 8 — zero external packages)

## Run
Press **Run** — the preview plays the game. Or on your machine:
\`\`\`bash
dotnet run
\`\`\`

## Architecture
- \`Program.cs\` — the REAL C# engine: background game-loop thread, grid math,
  self-collision, food placement, growth speed-up, score + high-score file,
  and three JSON endpoints (\`/api/state\`, \`/api/steer\`, \`/api/new\`).
- \`wwwroot/index.html\` — canvas renderer + keyboard input that calls the API.

Same code runs on Windows, macOS and Linux (.NET 8) and deploys to Azure,
IIS, nginx or a container unchanged.

## Files
- SnakeWeb.csproj — .NET 8 web project (Microsoft.NET.Sdk.Web)
- Program.cs — the whole engine (~80 lines, commented)
- wwwroot/index.html — the board UI
`,
      },
    ],
  },
  {
    id: 'electron',
    name: 'Electron Desktop App',
    framework: 'node',
    runtime: 'node',
    description: 'Electron desktop app (Windows/macOS/Linux). Cross-platform native UI via HTML.',
    icon: 'electron',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "my-electron-app",
  "version": "1.0.0",
  "description": "Built with Cloud Agent",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "devDependencies": {
    "electron": "^30.0.0",
    "electron-builder": "^24.13.0"
  },
  "build": {
    "appId": "com.cloudagent.myapp",
    "productName": "My Electron App",
    "files": ["main.js", "renderer.js", "index.html", "style.css"]
  }
}
`,
      },
      {
        path: 'main.js',
        content: `const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0a0e14',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })
  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
`,
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Electron App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello from Cloud Agent</h1>
    <p>Electron desktop app running.</p>
    <button id="btn">Click me</button>
    <p id="count">Clicks: 0</p>
  </main>
  <script src="renderer.js"></script>
</body>
</html>
`,
      },
      {
        path: 'renderer.js',
        content: `let count = 0
const btn = document.getElementById('btn')
const counter = document.getElementById('count')
btn.addEventListener('click', () => {
  count++
  counter.textContent = \`Clicks: \${count}\`
})
`,
      },
      {
        path: 'style.css',
        content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0a0e14;
  color: #e2e8f0;
  min-height: 100vh;
  display: grid;
  place-items: center;
}
main { text-align: center; }
h1 { font-size: 2.5rem; margin-bottom: 1rem; }
button {
  margin-top: 1rem;
  padding: 0.75rem 1.5rem;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 1rem;
  cursor: pointer;
}
button:hover { background: #334155; }
`,
      },
    ],
  },
  {
    id: 'backend-firebase',
    name: 'Backend: Firebase (Auth + Firestore)',
    framework: 'node',
    runtime: 'node',
    description: 'Real Firebase backend — Express API + firebase-admin (Auth token verify, Firestore CRUD) + user page + admin panel. Demo mode until FIREBASE_* secrets are added.',
    icon: 'flame',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "firebase-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node server/index.js",
    "dev": "node server/index.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "firebase-admin": "^12.1.0"
  }
}
`,
      },
      {
        path: 'server/index.js',
        content: `// Firebase backend (Cloud Agent starter) — REAL firebase-admin wiring.
// Demo mode: until FIREBASE_* secrets exist the API answers from an
// in-memory store so the preview works instantly. Add the real values in
// Secrets (or .env) and restart — every route becomes live Firestore/Auth.
const express = require('express')
const path = require('path')

const app = express()
app.use(express.json({ limit: '2mb' }))

const cfg = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
}
const serviceKey = process.env.FIREBASE_SERVICE_KEY // full JSON or base64
const live = Boolean(cfg.projectId && serviceKey)

let admin = null
let db = null
if (live) {
  try {
    admin = require('firebase-admin')
    let cred
    try { cred = admin.credential.cert(JSON.parse(serviceKey)) }
    catch { cred = admin.credential.cert(JSON.parse(Buffer.from(serviceKey, 'base64').toString('utf8'))) }
    admin.initializeApp({ credential: cred, projectId: cfg.projectId })
    db = admin.firestore()
    console.log('[firebase] live mode — project ' + cfg.projectId)
  } catch (e) {
    console.error('[firebase] admin init FAILED, staying in demo mode:', e.message)
  }
}
if (!admin) console.log('[firebase] demo mode — add FIREBASE_* secrets to go live')

// In-memory demo store (used only when not live)
const demo = { items: [] }

// ── health / config ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: live && db ? 'live' : 'demo', ts: new Date().toISOString() }))
app.get('/api/config', (_req, res) => res.json({ ...cfg, mode: live && db ? 'live' : 'demo' }))

// ── Auth: verify a Firebase ID token (Authorization: Bearer <idToken>) ──
app.get('/api/auth/me', async (req, res) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'missing bearer token' })
  if (!live || !admin) return res.status(503).json({ error: 'auth not live', hint: 'set FIREBASE_* secrets' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    res.json({ uid: decoded.uid, email: decoded.email || null, claims: decoded })
  } catch (e) {
    res.status(401).json({ error: 'invalid token', detail: e.message })
  }
})

// ── Firestore CRUD: /api/firestore/:collection ─────────────────
app.get('/api/firestore/:collection', async (req, res) => {
  const col = String(req.params.collection || '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (!col) return res.status(400).json({ error: 'bad collection' })
  if (!live || !db) return res.json({ mode: 'demo', items: demo[col] || [] })
  try {
    const snap = await db.collection(col).limit(200).get()
    res.json({ mode: 'live', items: snap.docs.map(d => ({ id: d.id, ...d.data() })) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/firestore/:collection', async (req, res) => {
  const col = String(req.params.collection || '').replace(/[^a-zA-Z0-9_-]/g, '')
  const body = req.body || {}
  if (!col || typeof body !== 'object') return res.status(400).json({ error: 'bad request' })
  if (!live || !db) {
    const item = { id: 'demo-' + Date.now(), ...body }
    ;(demo[col] = demo[col] || []).push(item)
    return res.status(201).json(item)
  }
  try {
    const ref = await db.collection(col).add(body)
    res.status(201).json({ id: ref.id, ...body })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/firestore/:collection/:id', async (req, res) => {
  const col = String(req.params.collection || '').replace(/[^a-zA-Z0-9_-]/g, '')
  const id = String(req.params.id || '')
  if (!live || !db) {
    demo[col] = (demo[col] || []).filter(x => x.id !== id)
    return res.json({ ok: true })
  }
  try { await db.collection(col).doc(id).delete(); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// ── static user app + admin app ────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')))

const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, '0.0.0.0', () => console.log('Firebase backend listening on port ' + PORT))
`,
      },
      {
        path: 'public/index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Items — User App</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
body{background:#0b1020;color:#e2e8f0;min-height:100vh;padding:24px}
.card{max-width:720px;margin:0 auto;background:#141b31;border:1px solid #233152;border-radius:14px;padding:20px}
h1{font-size:1.4rem;margin-bottom:4px}.mode{font-size:.8rem;color:#8ea0c0;margin-bottom:16px}
.row{display:flex;gap:8px;margin-bottom:14px}input{flex:1;background:#0b1020;border:1px solid #233152;color:#e2e8f0;border-radius:8px;padding:10px}
button{background:#3b82f6;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
ul{list-style:none}li{display:flex;justify-content:space-between;gap:8px;padding:10px;border-bottom:1px solid #1d2742}
a{color:#60a5fa}
</style>
</head>
<body>
<div class="card">
  <h1>🗂️ Items</h1><p class="mode" id="mode">checking backend…</p>
  <div class="row"><input id="name" placeholder="New item name"><button onclick="add()">Add</button></div>
  <ul id="list"></ul>
  <p style="margin-top:14px"><a href="/admin.html">Admin panel →</a></p>
</div>
<script>
async function load(){
  const h = await (await fetch('/api/health')).json();
  document.getElementById('mode').textContent = 'backend: ' + h.mode + ' mode';
  const d = await (await fetch('/api/firestore/items')).json();
  document.getElementById('list').innerHTML = (d.items||[]).map(i =>
    '<li><span>'+ (i.name||i.id) +'</span><button onclick="del(\\''+i.id+'\\')">✕</button></li>').join('') || '<li>no items yet</li>';
}
async function add(){
  const name = document.getElementById('name').value.trim(); if(!name) return;
  await fetch('/api/firestore/items', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  document.getElementById('name').value = ''; load();
}
async function del(id){ await fetch('/api/firestore/items/'+id, {method:'DELETE'}); load(); }
load();
</script>
</body>
</html>
`,
      },
      {
        path: 'public/admin.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin — Firebase Backend</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
body{background:#0a0f1e;color:#e2e8f0;min-height:100vh;padding:24px}
.card{max-width:860px;margin:0 auto;background:#121a2f;border:1px solid #233152;border-radius:14px;padding:20px}
h1{font-size:1.3rem}.mode{font-size:.8rem;color:#8ea0c0;margin:4px 0 16px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #1d2742;font-size:.9rem}
th{color:#8ea0c0;font-weight:600}button{background:#ef4444;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
.badge{display:inline-block;background:#1e293b;border-radius:999px;padding:2px 10px;font-size:.75rem}
a{color:#60a5fa}
</style>
</head>
<body>
<div class="card">
  <h1>🛠️ Admin Panel</h1><p class="mode"><span class="badge" id="mode">…</span> <a href="/">← user app</a></p>
  <table><thead><tr><th>ID</th><th>Name</th><th></th></tr></thead><tbody id="rows"></tbody></table>
</div>
<script>
async function load(){
  const h = await (await fetch('/api/health')).json();
  document.getElementById('mode').textContent = h.mode.toUpperCase();
  const d = await (await fetch('/api/firestore/items')).json();
  document.getElementById('rows').innerHTML = (d.items||[]).map(i =>
    '<tr><td>'+i.id+'</td><td>'+ (i.name||'') +'</td><td><button onclick="del(\\''+i.id+'\\')">delete</button></td></tr>').join('') || '<tr><td colspan="3">empty</td></tr>';
}
async function del(id){ await fetch('/api/firestore/items/'+id, {method:'DELETE'}); load(); }
load();
</script>
</body>
</html>
`,
      },
      {
        path: '.env.example',
        content: `# Copy real values from Firebase console → Project settings, or add them
# in Cloud Agent's Secrets panel (auto_collect_apis creates them too).
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=your-app.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-app.appspot.com
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=
# Service account JSON (single line) or the same JSON base64-encoded:
FIREBASE_SERVICE_KEY=
`,
      },
      {
        path: 'README.md',
        content: `# Firebase Backend (user app + admin app + server)

## Run
\`\`\`bash
npm install
PORT=3000 npm start
\`\`\`

## Parts
- **server/** — Express API: /api/health, /api/config, /api/auth/me (Firebase ID-token verify), /api/firestore/:collection (CRUD)
- **public/index.html** — user app (add/browse/delete items)
- **public/admin.html** — admin panel (table + delete)

## Go live (demo → real)
Add these via Cloud Agent Secrets (or .env): FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN,
FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID,
FIREBASE_APP_ID, FIREBASE_SERVICE_KEY (service-account JSON). Restart — Firestore
CRUD + Auth verify switch from the in-memory demo store to the real project.

## API
| Method | Path | What |
|---|---|---|
| GET | /api/health | mode (demo/live) + uptime |
| GET | /api/config | public firebase web config |
| GET | /api/auth/me | verify Authorization: Bearer <idToken> |
| GET | /api/firestore/:collection | list (200 docs) |
| POST | /api/firestore/:collection | create (JSON body) |
| DELETE | /api/firestore/:collection/:id | delete |
`,
      },
    ],
  },
  {
    id: 'backend-supabase',
    name: 'Backend: Supabase (Postgres REST)',
    framework: 'node',
    runtime: 'node',
    description: 'Real Supabase backend — Express API + @supabase/supabase-js (service-key CRUD) + user page + admin panel. Demo mode until SUPABASE_* secrets are added.',
    icon: 'zap',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "supabase-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node server/index.js",
    "dev": "node server/index.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "@supabase/supabase-js": "^2.43.1"
  }
}
`,
      },
      {
        path: 'server/index.js',
        content: `// Supabase backend (Cloud Agent starter) — REAL supabase-js wiring.
// Demo mode: until SUPABASE_* secrets exist the API answers from an
// in-memory store so the preview works instantly. Add the real values in
// Secrets (or .env) and restart — every route becomes live Postgres.
const express = require('express')
const path = require('path')

const app = express()
app.use(express.json({ limit: '2mb' }))

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''
const live = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY)

let sb = null
if (live) {
  try {
    const { createClient } = require('@supabase/supabase-js')
    // Service key = server-side only. Never expose it to the browser.
    sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    console.log('[supabase] live mode — ' + SUPABASE_URL)
  } catch (e) {
    console.error('[supabase] init FAILED, staying in demo mode:', e.message)
  }
}
if (!sb) console.log('[supabase] demo mode — add SUPABASE_URL + SUPABASE_SERVICE_KEY to go live')

// In-memory demo store (used only when not live)
const demo = { items: [] }
const clean = t => String(t || '').replace(/[^a-zA-Z0-9_-]/g, '')

app.get('/api/health', (_req, res) => res.json({ ok: true, mode: sb ? 'live' : 'demo', url: SUPABASE_URL || null, ts: new Date().toISOString() }))

// ── Table CRUD: /api/table/:name (Postgres via service client) ──
app.get('/api/table/:name', async (req, res) => {
  const table = clean(req.params.name)
  if (!table) return res.status(400).json({ error: 'bad table' })
  if (!sb) return res.json({ mode: 'demo', items: demo[table] || [] })
  try {
    const { data, error } = await sb.from(table).select('*').limit(200)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ mode: 'live', items: data })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/table/:name', async (req, res) => {
  const table = clean(req.params.name)
  const body = req.body || {}
  if (!table || typeof body !== 'object') return res.status(400).json({ error: 'bad request' })
  if (!sb) {
    const item = { id: 'demo-' + Date.now(), ...body }
    ;(demo[table] = demo[table] || []).push(item)
    return res.status(201).json(item)
  }
  try {
    const { data, error } = await sb.from(table).insert(body).select()
    if (error) return res.status(500).json({ error: error.message })
    res.status(201).json(data && data[0] ? data[0] : body)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/table/:name/:id', async (req, res) => {
  const table = clean(req.params.name)
  const id = req.params.id
  const patch = req.body || {}
  if (!sb) {
    const list = (demo[table] = demo[table] || [])
    const i = list.findIndex(x => x.id === id)
    if (i >= 0) list[i] = { ...list[i], ...patch }
    return res.json(i >= 0 ? list[i] : { error: 'not found' })
  }
  try {
    const { data, error } = await sb.from(table).update(patch).eq('id', id).select()
    if (error) return res.status(500).json({ error: error.message })
    res.json(data && data[0] ? data[0] : { ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/table/:name/:id', async (req, res) => {
  const table = clean(req.params.name)
  const id = req.params.id
  if (!sb) {
    demo[table] = (demo[table] || []).filter(x => x.id !== id)
    return res.json({ ok: true })
  }
  try {
    const { error } = await sb.from(table).delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── static user app + admin app ────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')))

const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, '0.0.0.0', () => console.log('Supabase backend listening on port ' + PORT))
`,
      },
      {
        path: 'public/index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Items — User App</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
body{background:#0b1020;color:#e2e8f0;min-height:100vh;padding:24px}
.card{max-width:720px;margin:0 auto;background:#141b31;border:1px solid #233152;border-radius:14px;padding:20px}
h1{font-size:1.4rem;margin-bottom:4px}.mode{font-size:.8rem;color:#8ea0c0;margin-bottom:16px}
.row{display:flex;gap:8px;margin-bottom:14px}input{flex:1;background:#0b1020;border:1px solid #233152;color:#e2e8f0;border-radius:8px;padding:10px}
button{background:#22c55e;color:#06210f;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;font-weight:600}
ul{list-style:none}li{display:flex;justify-content:space-between;gap:8px;padding:10px;border-bottom:1px solid #1d2742}
a{color:#60a5fa}
</style>
</head>
<body>
<div class="card">
  <h1>🗂️ Items</h1><p class="mode" id="mode">checking backend…</p>
  <div class="row"><input id="name" placeholder="New item name"><button onclick="add()">Add</button></div>
  <ul id="list"></ul>
  <p style="margin-top:14px"><a href="/admin.html">Admin panel →</a></p>
</div>
<script>
async function load(){
  const h = await (await fetch('/api/health')).json();
  document.getElementById('mode').textContent = 'backend: ' + h.mode + ' mode';
  const d = await (await fetch('/api/table/items')).json();
  document.getElementById('list').innerHTML = (d.items||[]).map(i =>
    '<li><span>'+ (i.name||i.id) +'</span><button onclick="del(\\''+i.id+'\\')">✕</button></li>').join('') || '<li>no items yet</li>';
}
async function add(){
  const name = document.getElementById('name').value.trim(); if(!name) return;
  await fetch('/api/table/items', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  document.getElementById('name').value = ''; load();
}
async function del(id){ await fetch('/api/table/items/'+id, {method:'DELETE'}); load(); }
load();
</script>
</body>
</html>
`,
      },
      {
        path: 'public/admin.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin — Supabase Backend</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
body{background:#0a0f1e;color:#e2e8f0;min-height:100vh;padding:24px}
.card{max-width:860px;margin:0 auto;background:#121a2f;border:1px solid #233152;border-radius:14px;padding:20px}
h1{font-size:1.3rem}.mode{font-size:.8rem;color:#8ea0c0;margin:4px 0 16px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #1d2742;font-size:.9rem}
th{color:#8ea0c0;font-weight:600}button{background:#ef4444;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
.badge{display:inline-block;background:#1e293b;border-radius:999px;padding:2px 10px;font-size:.75rem}
a{color:#60a5fa}
</style>
</head>
<body>
<div class="card">
  <h1>🛠️ Admin Panel</h1><p class="mode"><span class="badge" id="mode">…</span> <a href="/">← user app</a></p>
  <table><thead><tr><th>ID</th><th>Name</th><th></th></tr></thead><tbody id="rows"></tbody></table>
</div>
<script>
async function load(){
  const h = await (await fetch('/api/health')).json();
  document.getElementById('mode').textContent = h.mode.toUpperCase();
  const d = await (await fetch('/api/table/items')).json();
  document.getElementById('rows').innerHTML = (d.items||[]).map(i =>
    '<tr><td>'+i.id+'</td><td>'+ (i.name||'') +'</td><td><button onclick="del(\\''+i.id+'\\')">delete</button></td></tr>').join('') || '<tr><td colspan="3">empty</td></tr>';
}
async function del(id){ await fetch('/api/table/items/'+id, {method:'DELETE'}); load(); }
load();
</script>
</body>
</html>
`,
      },
      {
        path: '.env.example',
        content: `# Project Settings → API in the Supabase dashboard, or add them in
# Cloud Agent's Secrets panel (auto_collect_apis creates them too).
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=   # server only — never expose to the browser
`,
      },
      {
        path: 'README.md',
        content: `# Supabase Backend (user app + admin app + server)

## Run
\`\`\`bash
npm install
PORT=3000 npm start
\`\`\`

## Parts
- **server/** — Express API: /api/health, /api/table/:name (CRUD via service key)
- **public/index.html** — user app (add/browse/delete items)
- **public/admin.html** — admin panel (table + delete)

## Go live (demo → real)
Add via Cloud Agent Secrets (or .env): SUPABASE_URL, SUPABASE_ANON_KEY,
SUPABASE_SERVICE_KEY. Create an \`items\` table (id uuid pk default gen_random_uuid(), name text).
Restart — CRUD switches from the in-memory demo store to real Postgres.

## API
| Method | Path | What |
|---|---|---|
| GET | /api/health | mode (demo/live) |
| GET | /api/table/:name | list (200 rows) |
| POST | /api/table/:name | insert (JSON body) |
| PATCH | /api/table/:name/:id | update by id |
| DELETE | /api/table/:name/:id | delete by id |
`,
      },
    ],
  },
  {
    id: 'backend-nodeexpress',
    name: 'Backend: Node.js + Express (API + Admin)',
    framework: 'node',
    runtime: 'node',
    description: 'Full-product Node.js backend — Express REST API + JSON-file database (zero extra deps) + user app + admin panel. Works instantly offline; swap the store for any DB later.',
    icon: 'server',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "node-express-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node server/index.js",
    "dev": "node server/index.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
`,
      },
      {
        path: 'server/index.js',
        content: `// Node.js + Express backend (Cloud Agent starter) — REAL persistent store.
// Database = a JSON file on disk (server/data/db.json). Zero extra deps,
// works offline the moment you press Run. When you outgrow it, swap the
// four store* functions for Postgres/Mongo/Firebase — routes stay the same.
const express = require('express')
const path = require('path')
const fs = require('fs')

const app = express()
app.use(express.json({ limit: '2mb' }))

// ── tiny JSON-file store (persistent across restarts) ─────────────
const DATA_DIR = path.join(__dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')
let db = { items: [] }
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) } catch { /* first run */ }
function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
  } catch (e) { console.error('[store] save failed:', e.message) }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// ── API ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({
  ok: true,
  app: process.env.APP_NAME || 'node-express-backend',
  items: db.items.length,
  ts: new Date().toISOString(),
}))

app.get('/api/items', (_req, res) => res.json({ items: db.items }))

app.post('/api/items', (req, res) => {
  const name = String((req.body || {}).name || '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })
  const item = { id: uid(), name, done: false, createdAt: new Date().toISOString() }
  db.items.push(item); saveDb()
  res.status(201).json(item)
})

app.patch('/api/items/:id', (req, res) => {
  const item = db.items.find(x => x.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'not found' })
  const patch = req.body || {}
  if (typeof patch.name === 'string' && patch.name.trim()) item.name = patch.name.trim()
  if (typeof patch.done === 'boolean') item.done = patch.done
  saveDb()
  res.json(item)
})

app.delete('/api/items/:id', (req, res) => {
  const before = db.items.length
  db.items = db.items.filter(x => x.id !== req.params.id)
  if (db.items.length === before) return res.status(404).json({ error: 'not found' })
  saveDb()
  res.json({ ok: true })
})

// admin-only stats (token check when ADMIN_TOKEN secret is set)
app.get('/api/stats', (req, res) => {
  const token = process.env.ADMIN_TOKEN
  if (token && req.get('x-admin-token') !== token) {
    return res.status(401).json({ error: 'admin token required' })
  }
  res.json({
    items: db.items.length,
    done: db.items.filter(i => i.done).length,
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
  })
})

// ── static user app + admin app ────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')))

const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, '0.0.0.0', () => console.log('Node+Express backend listening on port ' + PORT))
`,
      },
      {
        path: 'public/index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tasks — User App</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
body{background:#0b1020;color:#e2e8f0;min-height:100vh;padding:24px}
.card{max-width:720px;margin:0 auto;background:#141b31;border:1px solid #233152;border-radius:14px;padding:20px}
h1{font-size:1.4rem;margin-bottom:4px}.mode{font-size:.8rem;color:#8ea0c0;margin-bottom:16px}
.row{display:flex;gap:8px;margin-bottom:14px}input{flex:1;background:#0b1020;border:1px solid #233152;color:#e2e8f0;border-radius:8px;padding:10px}
button{background:#22c55e;color:#06210f;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;font-weight:600}
ul{list-style:none}li{display:flex;justify-content:space-between;gap:8px;padding:10px;border-bottom:1px solid #1d2742;align-items:center}
.done span:first-child{text-decoration:line-through;opacity:.5}
a{color:#60a5fa}
</style>
</head>
<body>
<div class="card">
  <h1>✅ Tasks</h1><p class="mode" id="mode">checking backend…</p>
  <div class="row"><input id="name" placeholder="New task name"><button onclick="add()">Add</button></div>
  <ul id="list"></ul>
  <p style="margin-top:14px"><a href="/admin.html">Admin panel →</a></p>
</div>
<script>
async function load(){
  const h = await (await fetch('/api/health')).json();
  document.getElementById('mode').textContent = h.app + ' • ' + h.items + ' items saved';
  const d = await (await fetch('/api/items')).json();
  document.getElementById('list').innerHTML = (d.items||[]).map(i =>
    '<li class="'+(i.done?'done':'')+'"><span>'+ i.name +'</span><span>'+
    '<button style="background:#3b82f6;color:#fff" onclick="toggle(\\''+i.id+'\\','+!i.done+')">✓</button> '+
    '<button style="background:#ef4444;color:#fff" onclick="del(\\''+i.id+'\\')">✕</button></span></li>').join('') || '<li>no tasks yet</li>';
}
async function add(){
  const name = document.getElementById('name').value.trim(); if(!name) return;
  await fetch('/api/items', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  document.getElementById('name').value = ''; load();
}
async function toggle(id,done){ await fetch('/api/items/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({done})}); load(); }
async function del(id){ await fetch('/api/items/'+id, {method:'DELETE'}); load(); }
load();
</script>
</body>
</html>
`,
      },
      {
        path: 'public/admin.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin — Node + Express Backend</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
body{background:#0a0f1e;color:#e2e8f0;min-height:100vh;padding:24px}
.card{max-width:860px;margin:0 auto;background:#121a2f;border:1px solid #233152;border-radius:14px;padding:20px}
h1{font-size:1.3rem}.mode{font-size:.8rem;color:#8ea0c0;margin:4px 0 16px}
.stats{display:flex;gap:12px;margin-bottom:16px}
.stat{flex:1;background:#0a0f1e;border:1px solid #233152;border-radius:10px;padding:12px;text-align:center}
.stat b{font-size:1.3rem;display:block}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #1d2742;font-size:.9rem}
th{color:#8ea0c0;font-weight:600}button{background:#ef4444;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
a{color:#60a5fa}
</style>
</head>
<body>
<div class="card">
  <h1>🛠️ Admin Panel</h1><p class="mode" id="mode">… <a href="/">← user app</a></p>
  <div class="stats">
    <div class="stat"><b id="s-items">–</b>items</div>
    <div class="stat"><b id="s-done">–</b>done</div>
    <div class="stat"><b id="s-up">–</b>uptime s</div>
    <div class="stat"><b id="s-node">–</b>node</div>
  </div>
  <table><thead><tr><th>ID</th><th>Name</th><th>Status</th><th></th></tr></thead><tbody id="rows"></tbody></table>
</div>
<script>
async function load(){
  const h = await (await fetch('/api/health')).json();
  document.getElementById('mode').textContent = h.app + ' • live JSON store';
  try {
    const s = await (await fetch('/api/stats')).json();
    document.getElementById('s-items').textContent = s.items;
    document.getElementById('s-done').textContent = s.done;
    document.getElementById('s-up').textContent = s.uptimeSec;
    document.getElementById('s-node').textContent = s.node;
  } catch(e) { document.getElementById('mode').textContent = 'stats need ADMIN_TOKEN'; }
  const d = await (await fetch('/api/items')).json();
  document.getElementById('rows').innerHTML = (d.items||[]).map(i =>
    '<tr><td>'+i.id+'</td><td>'+ (i.name||'') +'</td><td>'+ (i.done?'done':'open') +'</td>'+
    '<td><button onclick="del(\\''+i.id+'\\')">delete</button></td></tr>').join('') || '<tr><td colspan="4">empty</td></tr>';
}
async function del(id){ await fetch('/api/items/'+id, {method:'DELETE'}); load(); }
load();
</script>
</body>
</html>
`,
      },
      {
        path: '.env.example',
        content: `# Copy real values into Cloud Agent's Secrets panel (or .env) and restart.
PORT=3000
APP_NAME=node-express-backend
# Set ADMIN_TOKEN to protect /api/stats (send it as the x-admin-token header)
ADMIN_TOKEN=
`,
      },
      {
        path: 'README.md',
        content: `# Node.js + Express Backend (user app + admin app + server)

## Run
\`\`\`bash
npm install
PORT=3000 npm start
\`\`\`

## Parts
- **server/index.js** — Express API: /api/health, /api/items CRUD, /api/stats
- **server/data/db.json** — JSON-file database (auto-created, persistent)
- **public/index.html** — user app (add / complete / delete tasks)
- **public/admin.html** — admin panel (stats + table + delete)

## Swap the database
The whole store is 4 functions (saveDb + the db object). Replace them with
Postgres / Mongo / Firebase when ready — routes and pages stay unchanged.

## API
| Method | Path | What |
|---|---|---|
| GET | /api/health | app + item count |
| GET | /api/items | list all |
| POST | /api/items | create ({"name"}) |
| PATCH | /api/items/:id | rename / toggle done |
| DELETE | /api/items/:id | delete by id |
| GET | /api/stats | admin stats (x-admin-token when ADMIN_TOKEN set) |
`,
      },
    ],
  },
]

// ════════════════════════════════════════════════════════════════════════════
// Template Marketplace — framework starters (TEMPLATES) + ready-made apps
// (APP_TEMPLATES from app-templates-b). Both are real, runnable starters.
// ════════════════════════════════════════════════════════════════════════════
import { APP_TEMPLATES } from './app-templates-b'

export const ALL_TEMPLATES: TemplateDef[] = [...TEMPLATES, ...APP_TEMPLATES]

export function getTemplate(id: string): TemplateDef | undefined {
  return ALL_TEMPLATES.find(t => t.id === id)
}
