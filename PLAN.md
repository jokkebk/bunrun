# bunrun — Plan & Spec

A local web dashboard (Bun + Svelte 5) for managing a dozen vibe-coded dev apps:
run them, watch their output, manage their `.env` secrets, and identify them fast.

Single-user, localhost-only tool. Trust model: same machine, same user.

---

## Architecture decisions (settled)

### Lifecycle & process ownership
- **On-demand server (model A).** You run `bun run bunrun`; it spawns child processes as
  its own children. When bunrun dies, all child apps die. No PID persistence, no orphan
  reconciliation, no reattachment — clean slate every launch.
- **No auto-restart.** This is not a health monitor. Crashed processes show red + exit code
  and keep their captured output; you decide when to restart. (`/health` support is a future idea.)

### Process model
- **A project = a set of named processes** (usually 1, sometimes 2–3: frontend/backend/worker).
- **Per-process** start/stop/restart buttons, plus a **"Start all"** for the project.
- **"Running" = process is alive.** Nothing more. Works on apps that never print a URL/port.

### Process spawning & teardown (correctness-critical)
- Spawn each process in its **own process group** (detached), run command via **`sh -c`**
  (shell string, so pipes / `&&` / env-prefixes work).
- **Stop = SIGTERM to the whole group → ~4s grace → SIGKILL** if still alive. Killing the
  group (not just the shell) is what frees the port so restart works.
- **Restart = stop (confirm dead + port freed) → start**, sequential, no overlap.
- **On bunrun exit**, tear down all process groups the same way — no orphans holding ports.

### Ports & URLs (observe-only)
- bunrun **does not assign ports.** Apps use their own `.env`/config/defaults.
- URL/port learned by: declared `port`/`url` in config (default/hint) **+ stdout scraping**
  (Vite/Next/generic `localhost:PORT` patterns, optional per-process `urlPattern` regex override).
  Scraped port wins over stale configured port (busy-port fallback case).
- Later idea: bunrun *suggests/writes* a unique `PORT=` into each app's `.env` to avoid
  collisions (still never injects at spawn time).

### Auto-open browser
- On a process with `openOnStart` coming up and a URL known: macOS **`open <url>`**
  (default browser, reuse-or-create tab).
- Open when URL is known (scraped or declared); **10s scrape ceiling**, else open nothing.

---

## Config & storage

### Location
- **Inside the repo dir, gitignored:** `<repo>/data/`
  - `data/projects.yaml` — project registry (the contract)
  - `data/vault.yaml` — key vault
  - `data/logs/<project-id>/` — opt-in JSONL logs

### `projects.yaml` (single file; watch-and-reload)
- The Bun server **watches the file and reloads on change** (debounced); ignores reloads
  triggered by its own writes. So a skill scan while bunrun is down *or* up is picked up.
- One file holds both run config and user state. User state lives under a `ui:` block that
  the discovery skill **must preserve** on re-scan.

```yaml
- id: pimio                      # stable slug; also the state key
  name: Pimio
  path: /Users/.../koodi/pimio   # absolute
  category: null                 # reserved, unused in v1
  favicon: public/favicon.ico    # relative to path, optional
  envFile: .env                  # relative to path, optional
  processes:
    - name: dev                  # label shown on the row
      command: bun run dev       # shell string, run via `sh -c`
      cwd: null                  # optional, defaults to path
      port: 5173                 # hint, optional
      url: null                  # explicit override, optional
      urlPattern: null           # regex override for scraping, optional
      openOnStart: true          # auto-open tab, optional
  ui:                            # bunrun-owned; skill leaves it alone
    pinned: true
    logEnabled: false
```

### Discovery (AI-assisted, no fragile heuristics)
- A **Claude Code skill (`SKILL.md`) shipped in the repo.** You point it at a folder; the AI
  inspects the project (package.json scripts, lockfile → package manager, `.env`, favicon,
  python markers, ports) and **writes/updates an entry in `data/projects.yaml`**, preserving
  `ui:` blocks. The `SKILL.md` documents the schema + file path.
- Supports **single** (one project dir) and **bulk** (a parent like `~/koodi/`) scans.
- **Manual add/edit** in the UI is also available (bare entry you edit) — AI is the smart path,
  not the only path.

---

## UI (Svelte 5 SPA, served by Bun)

### Stack
- **Plain Svelte 5 + Vite**, built to static assets, **served by the Bun server** (no SvelteKit).
- Bun owns everything server-side: API (POST for control), **SSE** for live log streaming,
  static file serving. Dev: Vite dev server proxies `/api` + `/events` to Bun; prod: `vite build`
  then Bun serves static — running bunrun is one process.
- **Bind to 127.0.0.1 only, no auth.**

### Layout: master-detail
- **Wide sidebar (~⅓ width).** Each row is a compact card with everything inline: favicon,
  name, path, status dot, per-process start/stop/restart. Sized so ~10 rows are visible.
- **Ordering:** running → pinned → alphabetical; a **crashed process floats to the top** of
  running. Selection follows the project as the list reorders.
- **Filtering:** search box (name + path). No categories in v1 (field reserved).
- **Main pane = output**, split into **stacked full-width horizontal rows**, one per process
  (1 proc = full height; 3 = thirds). **Click a row header to expand/focus** it (others collapse
  to strips). All configured processes get a row (stopped ones show "not running" + start button).
- **Vault, settings, project add/edit, .env editor → modals** (keeps the single-screen model).

### Favicon / visual ID
- **Detect from project files** (`public/favicon.*`, `static/`, etc.); store resolved path;
  bunrun serves the file. Fallback: **colored initial** chip. bunrun never generates/injects
  icons — if an app lacks one, you add it in the project (so its own tab shows it too).

### Output capture & logs
- **Per-process in-memory ring buffer** (~5,000 lines / ~2 MB) for the live view; streamed via
  **SSE**. Lost on bunrun restart (fine — everything's ephemeral).
- **Render ANSI → colored HTML** in the live view (spot red errors at a glance).
- **Virtualized scrolling** for the log view (only render visible rows).
- **Opt-in per-project disk logging** (`ui.logEnabled`): additionally write **JSONL**
  (`{ts, stream, line}`, ANSI stripped from `line`) to `data/logs/<id>/`. Size-based rotation
  (~10 MB, few generations). Designed so a **future CLI/agent** can query logs.

---

## Secrets: `.env` editor + key vault

### `.env` editor (modal from selected project)
- **Surgical read/write** of the project's configured `envFile` (default `.env`): parse into
  comment / blank / `key=value` lines; **edit values in place, preserve comments & order,
  append new keys** — never reformat the whole file.
- Recognizes a **commented-out `#KEY=value`** as a *disabled key* → **comment/uncomment toggle**
  (distinct from freeform doc comments).
- Per key: name, **value masked by default** (reveal toggle), active/commented toggle,
  edit-value, delete; new-key button.
- **Reverse-lookup labels:** if a value matches a vault entry, show its **label chip**
  ("🔵 Corporate OpenAI") instead of the masked secret. Exact-value match.

### Key vault (`vault.yaml`, plaintext to start)
- Entry: `label`, `value`, `owner`/tag (corporate/personal), `provider`, optional `defaultVarName`.
- **Plaintext** — same exposure as the `.env` files already on disk, centralized. Harden
  (Keychain / encryption) only when the projects themselves get hardened. Access behind a small
  interface so swapping later is contained.
- **Share secrets via the vault only** (one mechanism): "Add from vault" in the .env editor →
  searchable picker (grouped by owner/provider) → inserts key using `defaultVarName` (editable)
  with the value. Picker also has **"add new vault entry"** (create + insert in one flow).
- **"Promote to vault":** unrecognized secret in a project's `.env` → one-click save to vault
  (label/owner) to bootstrap the vault from existing apps.

---

## Recommended phasing

**Phase 1 — core runner (the daily driver)**
- Bun server: read `projects.yaml`, spawn/stop/restart with process groups + SIGTERM/KILL,
  ring-buffer capture, SSE streaming, stdout URL scraping, auto-open.
- Svelte master-detail UI: sidebar (search, ordering, per-process controls), stacked output
  rows with focus, status dots, pin toggle. ANSI rendering + virtualized log view.
- Manual add/edit of projects. Watch-and-reload of `projects.yaml`.

**Phase 2 — discovery + secrets**
- `SKILL.md` discovery skill (single + bulk), favicon detection.
- `.env` editor (surgical writer, comment toggle, mask/reveal).
- Vault + reverse-lookup labels + add-from-vault + promote-to-vault.

**Phase 3 — logging & polish**
- Opt-in JSONL disk logging + rotation.
- Combined/interleaved output view; per-project browser override; grace-period override.

**Deferred / future**
- Log-query CLI for agents (JSONL format already supports it).
- `/health` URL checks. Port auto-assignment into `.env`. `bunrun.yaml`-in-project opt-in.
  Promoting the runner to a launchd daemon (module already UI-agnostic). Vault hardening.
