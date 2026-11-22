/**
 * Language-first project creation — the canonical 14-language registry.
 *
 * Each language maps to a REAL scaffold: either an existing template id
 * (scaffolded by /api/projects via getTemplate) or an inline minimal
 * starter defined here. Picking a language seeds the project with working
 * files so the agent (and the preview) have something real to build on
 * immediately — "AI language onujayi shob kisui setup kore felbe".
 *
 * Additive by design: templates.ts stays untouched; the two starter lists
 * coexist (the Create dialog shows "Advanced starters" for the rest).
 */

export interface ScaffoldFile {
  path: string
  content: string
}

export interface LanguageDef {
  id: string
  label: string
  icon: string
  tagline: string
  /** Existing template id (templates.ts) used to seed the project. */
  templateId?: string
  /** Inline scaffold for languages that have no template yet. */
  files?: ScaffoldFile[]
  /** How the project runs in preview (shown under the card). */
  runs: string
  /** Publish targets that make sense for this language. */
  publish: string[]
}

/* ── Inline starters for languages without a template ─────────────────── */

const TS_NODE_STARTER: ScaffoldFile[] = [
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'typescript-app',
        version: '1.0.0',
        private: true,
        main: 'dist/index.js',
        scripts: {
          build: 'tsc',
          start: 'node dist/index.js',
          dev: 'tsc -w & node --watch dist/index.js',
        },
        dependencies: { express: '^4.19.2' },
        devDependencies: { typescript: '^5.4.5', '@types/node': '^20.12.7', '@types/express': '^4.17.21' },
      },
      null,
      2,
    ),
  },
  {
    path: 'tsconfig.json',
    content: JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'commonjs',
          outDir: 'dist',
          rootDir: 'src',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src'],
      },
      null,
      2,
    ),
  },
  {
    path: 'src/index.ts',
    content: `import express from 'express'

const app = express()
const PORT = Number(process.env.PORT) || 3000

app.get('/', (_req, res) => {
  res.json({ ok: true, message: 'TypeScript app is running', ts: new Date().toISOString() })
})

app.listen(PORT, () => console.log(\`TypeScript app listening on port \${PORT}\`))
`,
  },
]

const JAVA_SPRING_STARTER: ScaffoldFile[] = [
  {
    path: 'pom.xml',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.2.5</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <!-- Declares the spring-boot plugin prefix so mvn spring-boot:run
           resolves (without this the run fails with "No plugin found for
           prefix spring-boot" — fixed in v77). -->
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <version>3.2.5</version>
      </plugin>
    </plugins>
  </build>
</project>
`,
  },
  {
    path: 'src/main/java/com/example/AppApplication.java',
    content: `package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class AppApplication {
  public static void main(String[] args) {
    SpringApplication.run(AppApplication.class, args);
  }
}

@RestController
class HelloController {
  @GetMapping("/")
  public String home() {
    return "Java Spring Boot app is running";
  }
}
`,
  },
  {
    path: 'src/main/resources/application.properties',
    content: 'server.port=${PORT:8080}\nspring.application.name=app\n',
  },
]

const PHP_STARTER: ScaffoldFile[] = [
  {
    path: 'composer.json',
    content: JSON.stringify(
      { name: 'cloud-agent/php-app', description: 'PHP app built with Cloud Agent', require: { php: '>=8.1' }, autoload: { 'psr-4': { 'App\\': 'src/' } } },
      null,
      2,
    ),
  },
  {
    path: 'index.php',
    content: `<?php
declare(strict_types=1);

header('Content-Type: application/json');

$routes = [
  '/' => fn () => ['ok' => true, 'message' => 'PHP app is running', 'time' => date('c')],
  '/health' => fn () => ['status' => 'healthy'],
];

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$handler = $routes[$uri] ?? null;

if ($handler === null) {
  http_response_code(404);
  echo json_encode(['error' => 'not found', 'path' => $uri]);
  exit;
}

echo json_encode($handler());
`,
  },
  {
    path: 'src/Kernel.php',
    content: `<?php
declare(strict_types=1);

namespace App;

class Kernel
{
  public function version(): string
  {
    return '1.0.0';
  }
}
`,
  },
]

const CSHARP_STARTER: ScaffoldFile[] = [
  {
    path: 'Api.csproj',
    content: `<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>CloudAgentApp</RootNamespace>
  </PropertyGroup>

</Project>
`,
  },
  {
    path: 'Program.cs',
    content: `// Cloud Agent C# starter — ASP.NET Core minimal API (dotnet 8)
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var started = DateTime.UtcNow;

app.MapGet("/", () => Results.Json(new {
    ok = true,
    message = "C# app is running",
    framework = "aspnetcore-minimal",
    uptimeSeconds = (long)(DateTime.UtcNow - started).TotalSeconds,
}));

app.MapGet("/api/health", () => Results.Json(new { status = "healthy", ts = DateTime.UtcNow }));

app.MapGet("/api/hello", (string? name) =>
    Results.Json(new { hello = string.IsNullOrWhiteSpace(name) ? "world" : name }));

var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(port))
{
    app.Urls.Add($"http://0.0.0.0:{port}");
}

app.Run();
`,
  },
  {
    path: '.gitignore',
    content: 'bin/\nobj/\n',
  },
]

const CPP_STARTER: ScaffoldFile[] = [
  {
    path: 'main.cpp',
    content: `// Cloud Agent C++ starter — zero-dependency HTTP server (POSIX sockets, C++17).
// Compile: g++ -std=c++17 -O2 -pthread main.cpp -o app
// Run:     PORT=3000 ./app
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cctype>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <thread>

static std::string json_escape(const std::string& s) {
    std::string out;
    for (char c : s) {
        switch (c) {
            case '"': out += "\\\\\\""; break;
            case '\\\\': out += "\\\\\\\\"; break;
            case '\\n': out += "\\\\n"; break;
            case '\\r': out += "\\\\r"; break;
            case '\\t': out += "\\\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) out += ' ';
                else out += c;
        }
    }
    return out;
}

static void send_response(int fd, int status, const std::string& body,
                          const std::string& content_type = "application/json") {
    const char* status_text = status == 200 ? "OK" : status == 404 ? "Not Found" : "Error";
    std::ostringstream res;
    res << "HTTP/1.1 " << status << " " << status_text << "\\r\\n"
        << "Content-Type: " << content_type << "\\r\\n"
        << "Content-Length: " << body.size() << "\\r\\n"
        << "Connection: close\\r\\n\\r\\n"
        << body;
    const std::string out = res.str();
    send(fd, out.data(), out.size(), 0);
}

// Tiny URL router: path -> response body
static bool handle(const std::string& method, const std::string& raw_path, int fd) {
    // Split "/api/hello?name=x" → path "/api/hello" + query "name=x".
    // The preview proxy forwards its own query params too (e.g.
    // "/?XTransformPort=4000"), so the root route MUST ignore them.
    std::string path = raw_path;
    std::string query;
    const size_t qpos = raw_path.find('?');
    if (qpos != std::string::npos) {
        path = raw_path.substr(0, qpos);
        query = raw_path.substr(qpos + 1);
    }
    if (method != "GET" && method != "HEAD") {
        send_response(fd, 405, "{\\"error\\":\\"method not allowed\\"}");
        return true;
    }
    if (path == "/") {
        const std::string html =
            "<!doctype html><html><head><meta charset=\\"utf-8\\"><title>C++ App</title>"
            "<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;"
            "display:grid;place-items:center;height:100vh;margin:0}"
            ".c{text-align:center}h1{color:#38bdf8}code{background:#1e293b;padding:2px 6px;border-radius:4px}</style>"
            "</head><body><div class=\\"c\\"><h1>C++ app is running</h1>"
            "<p>Zero-dependency POSIX-socket HTTP server.</p>"
            "<p>Try <code>/api/health</code> and <code>/api/hello?name=you</code></p></div></body></html>";
        send_response(fd, 200, html, "text/html; charset=utf-8");
        return true;
    }
    if (path == "/api/health") {
        send_response(fd, 200,
            "{\\"status\\":\\"healthy\\"}");
        return true;
    }
    if (path.rfind("/api/hello", 0) == 0) {
        std::string name = "world";
        std::istringstream qs(query);
        std::string kv;
        while (std::getline(qs, kv, '&')) {
            const size_t eq = kv.find('=');
            if (eq != std::string::npos && kv.substr(0, eq) == "name" && kv.size() > eq + 1) {
                name = kv.substr(eq + 1);
            }
        }
        send_response(fd, 200,
            "{\\"hello\\":\\"" + json_escape(name) + "\\"}");
        return true;
    }
    send_response(fd, 404, "{\\"error\\":\\"not found\\",\\"path\\":\\"" + json_escape(path) + "\\"}");
    return true;
}

int main() {
    const int port = []() {
        if (const char* p = std::getenv("PORT")) {
            try { return std::stoi(p); } catch (...) {}
        }
        return 3000;
    }();

    const int server = ::socket(AF_INET, SOCK_STREAM, 0);
    if (server < 0) { std::cerr << "socket() failed\\n"; return 1; }
    int opt = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(static_cast<uint16_t>(port));

    if (::bind(server, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::cerr << "bind() failed on port " << port << "\\n";
        return 1;
    }
    if (::listen(server, 64) < 0) { std::cerr << "listen() failed\\n"; return 1; }

    std::cout << "C++ app listening on port " << port << std::endl;

    while (true) {
        sockaddr_in client{};
        socklen_t len = sizeof(client);
        const int fd = ::accept(server, reinterpret_cast<sockaddr*>(&client), &len);
        if (fd < 0) continue;
        std::thread([fd]() {
            char buf[4096];
            ssize_t n = ::recv(fd, buf, sizeof(buf) - 1, 0);
            if (n > 0) {
                buf[n] = '\\0';
                std::string req(buf);
                std::istringstream line(req);
                std::string method, path;
                line >> method >> path;
                if (path.empty()) path = "/";
                try { handle(method, path, fd); } catch (...) {}
            }
            ::close(fd);
        }).detach();
    }
}
`,
  },
  {
    path: 'Makefile',
    content: `.RECIPEPREFIX = >
CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -pthread -Wall
TARGET ?= app

all: $(TARGET)

$(TARGET): main.cpp
>       $(CXX) $(CXXFLAGS) main.cpp -o $(TARGET)

run: $(TARGET)
>       PORT=\${PORT:-3000} ./$(TARGET)

clean:
>       rm -f $(TARGET)

.PHONY: all run clean
`,
  },
]

/* ── The builder languages (owner asked for C# and C++ too) ───────────── */

export const LANGUAGES: LanguageDef[] = [
  {
    id: 'html',
    label: 'HTML / CSS / JS',
    icon: '🌐',
    tagline: 'Instant static web app — preview works with zero build',
    templateId: 'static',
    runs: 'Served as-is in preview',
    publish: ['web', 'pwa', 'source-archive', 'apk', 'aab'],
  },
  {
    id: 'javascript',
    label: 'JavaScript + Node',
    icon: '🟨',
    tagline: 'Express API / server — the classic JS backend',
    templateId: 'node-express',
    runs: 'npm start → Node server',
    publish: ['web', 'source-archive', 'exe-windows'],
  },
  {
    id: 'typescript',
    label: 'TypeScript + Node',
    icon: '🟦',
    tagline: 'Type-safe Express API compiled with tsc',
    files: TS_NODE_STARTER,
    runs: 'tsc build → node dist',
    publish: ['web', 'source-archive', 'exe-windows'],
  },
  {
    id: 'react',
    label: 'React',
    icon: '⚛️',
    tagline: 'Vite + React + TypeScript SPA',
    templateId: 'vite-react',
    runs: 'vite dev server',
    publish: ['web', 'pwa', 'source-archive', 'apk', 'aab', 'exe-windows'],
  },
  {
    id: 'nextjs',
    label: 'Next.js',
    icon: '▲',
    tagline: 'App Router — full-stack React with API routes',
    templateId: 'next',
    runs: 'next dev server',
    publish: ['web', 'pwa', 'source-archive'],
  },
  {
    id: 'vue',
    label: 'Vue 3',
    icon: '💚',
    tagline: 'Vue 3 + Vite composition API',
    templateId: 'vue',
    runs: 'vite dev server',
    publish: ['web', 'pwa', 'source-archive', 'apk', 'aab'],
  },
  {
    id: 'svelte',
    label: 'Svelte',
    icon: '🔶',
    tagline: 'Svelte + Vite — compiled, tiny bundles',
    templateId: 'svelte',
    runs: 'vite dev server',
    publish: ['web', 'pwa', 'source-archive', 'apk', 'aab'],
  },
  {
    id: 'dart',
    label: 'Dart / Flutter',
    icon: '🎯',
    tagline: 'Flutter — web preview + Android/iOS/Linux code targets (all scaffolded on Run)',
    templateId: 'flutter-web',
    runs: 'flutter run -d web-server',
    publish: ['apk', 'aab', 'web', 'source-archive', 'app-store', 'f-droid'],
  },
  {
    id: 'python',
    label: 'Python + FastAPI',
    icon: '🐍',
    tagline: 'FastAPI backend with uvicorn',
    templateId: 'python-fastapi',
    runs: 'uvicorn main:app',
    publish: ['web', 'source-archive'],
  },
  {
    id: 'java',
    label: 'Java + Spring Boot',
    icon: '☕',
    tagline: 'Spring Boot 3 web app (Maven)',
    files: JAVA_SPRING_STARTER,
    runs: 'mvn spring-boot:run',
    publish: ['source-archive'],
  },
  {
    id: 'php',
    label: 'PHP',
    icon: '🐘',
    tagline: 'PHP 8 JSON app with composer autoload',
    files: PHP_STARTER,
    runs: 'php -S 0.0.0.0:$PORT',
    publish: ['web', 'source-archive'],
  },
  {
    id: 'go',
    label: 'Go',
    icon: '🐹',
    tagline: 'net/http API — single static binary',
    templateId: 'go-api',
    runs: 'go run .',
    publish: ['web', 'source-archive', 'exe-windows'],
  },
  {
    id: 'rust',
    label: 'Rust + Axum',
    icon: '🦀',
    tagline: 'Axum web API — fast and safe',
    templateId: 'rust-axum',
    runs: 'cargo run',
    publish: ['web', 'source-archive', 'exe-windows'],
  },
  {
    id: 'csharp',
    label: 'C# / .NET 8',
    icon: '🎯',
    tagline: 'ASP.NET Core minimal API — real dotnet web server',
    files: CSHARP_STARTER,
    runs: 'dotnet run',
    publish: ['web', 'source-archive', 'exe-windows'],
  },
  {
    id: 'cpp',
    label: 'C++',
    icon: '🔧',
    tagline: 'Zero-dependency C++17 HTTP server (POSIX sockets + g++)',
    files: CPP_STARTER,
    runs: 'g++ build → ./app',
    publish: ['web', 'source-archive', 'exe-windows'],
  },
  {
    id: 'capacitor',
    label: 'Capacitor Mobile',
    icon: '📱',
    tagline: 'Web tech → native Android shell (APK ready)',
    templateId: 'capacitor',
    runs: 'vite dev server (+ native shell)',
    publish: ['apk', 'aab', 'web', 'pwa', 'google-play', 'app-store'],
  },
]

export const LANGUAGE_IDS = LANGUAGES.map(l => l.id)

export function getLanguage(id: string): LanguageDef | undefined {
  return LANGUAGES.find(l => l.id === id)
}

/**
 * Resolve the scaffold files for a language selection.
 * Inline-defined languages return their own files; template-backed ones
 * are resolved by /api/projects through getTemplate — this helper only
 * covers the inline case so the API route stays thin.
 */
export function getLanguageScaffold(id: string): ScaffoldFile[] {
  return getLanguage(id)?.files || []
}
