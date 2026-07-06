---
name: bunrun-discover
description: Discover dev projects under a folder (or scan one project dir) and write/update entries in `data/projects.yaml` for the bunrun dashboard. Use when the user wants to register apps with bunrun, asks to "scan" or "discover" projects, or wants bunrun to pick up new apps. Preserves user-owned `ui:` state on re-scan.
---

# bunrun-discover

Inspect project directories and write/update entries in `data/projects.yaml` so the
bunrun dashboard can run them. Single-user, localhost trust model — see `PLAN.md`.

## What this skill writes

The single source of truth is `data/projects.yaml` at the bunrun repo root (the
directory containing this `SKILL.md`). The live schema lives in
`server/config.ts` — see `ProjectConfig` (`server/config.ts:30`) and
`ProcessConfig` (`server/config.ts:15`). Read those types before editing; do not
guess.

The server parses the file with a small tolerant parser (`yamlParseLite` in
`server/config.ts:138`) and re-serializes with `serializeProjectsYaml`
(`server/config.ts:194`) — that block-style layout is the canonical form. **Always
emit block-style YAML** as shown in `PLAN.md`, even if the existing file is the
one-line JSON-flow form (legacy). First scan normalizes it; the server's watcher
will reload cleanly either way.

A project entry looks like:

```yaml
- id: pimio
  name: Pimio
  path: /Users/you/koodi/pimio
  category: null
  favicon: public/favicon.ico
  envFile: .env
  processes:
    - name: dev
      command: bun run dev
      cwd: null
      port: 5173
      url: null
      urlPattern: null
      openOnStart: true
  ui:
    pinned: false
    logEnabled: false
```

All fields are required at the YAML level (use `null`, not blank, for absent
values). The server's sanitizer tolerates missing fields but you should not
rely on that.

## Non-negotiable: preserve user state on re-scan

A re-scan must never destroy user-owned state. When updating an existing entry
matched by **stable `id`**:

- **Always preserve** `ui:` (the entire block — `pinned`, `logEnabled`, and any
  future keys), `category`, and `name` — unless `name` still equals the prior
  discovered default (the humanized dir name). If the user renamed it (i.e. it
  no longer matches the humanized form), keep their name.
- **Swap** the discovered fields: `path`, `favicon`, `envFile`, `processes`.
- **Never delete** an entry unless the user explicitly asks. Stale projects stay
  in the registry until the user removes them in the UI.

## When to use this skill

User says any of: "scan/add/register projects for bunrun", "discover apps under
~/koodi", "pick up new projects for the dashboard", "re-scan bunrun", etc.

## Invocation

Ask the user for the target. Then:

- **Single scan**: one project dir. Inspect it, write/update one entry.
- **Bulk scan**: ask the user for **a list of root dirs** (e.g. `~/koodi`,
  `~/work`) and a **max depth** (default 1 = direct children only). Walk that
  many levels. This is intentionally conservative — never depth-first the
  entire filesystem.

### Skip these dirs at any depth

Always skip: `node_modules`, `.git`, `.cache`, `dist`, `build`, `.next`,
`.turbo`, `.svelte-kit`, `.venv`, `venv`, `__pycache__`, `target`, `out`,
`.output`, `.vercel`, hidden dirs (starting with `.`).

### A dir is a "project" if it contains one of

- `package.json` (Node/Bun)
- `pyproject.toml`, `setup.py`, `requirements.txt` (Python)
- `Cargo.toml` (Rust)
- `go.mod` (Go)
- `Dockerfile` + `compose.yml`/`compose.yaml`/`docker-compose.yml` (container-only app)

If multiple markers are present, prefer Node > Python > Rust > Go > Docker.

### Recursion vs leaf

Walk up to `maxDepth` levels. A dir matching a marker is a leaf — do not descend
into it. Non-matching intermediate dirs are walked (subject to the skip list).

### Monorepo emphasis

Per-workspace splitting is **opt-in and conservative**. Detect signals:

- `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, or `workspaces` field in
  `package.json` → candidate.

If those signals exist, **prompt the user**: "I see a monorepo at X with
workspaces A, B, C — add as a single entry with multiple processes, or one
entry per workspace?" Don't auto-fragment. Default to a single entry.

### Collision handling

If a discovered `id` already exists **but the `path` differs**, do not
overwrite. Prompt the user whether to (a) keep the existing entry, (b) update it
in place, or (c) register the new one under a suffixed id (`pimio-2`). Never
silently clobber.

## Per-project discovery procedure

For each project dir:

### id

Slug from the **directory name**: lowercase, replace `[^a-z0-9]+` with `-`, trim
leading/trailing `-`. Example: `Talisman-Web` → `talisman-web`, `Pimio` → `pimio`.
Stable across re-scans (dir name unchanged → id unchanged).

### name

Humanized dir name: replace `-`/`_`/`.` with spaces, title-case words. Example:
`talisman-web` → `Talisman Web`. **On re-scan keep the user's name** unless it
equals the prior discovered default.

### path

Absolute, real, expanded (`~` → home). Use `realpath`-equivalent. Never a
trailing slash.

### envFile

`.env` if a file with that exact name exists in the project dir, else `null`.
Do not invent other locations.

### favicon

Search these candidates, **first hit wins**, store path **relative to project
`path`** (so `public/favicon.ico`, never `/Users/.../public/favicon.ico`):

1. `public/favicon.ico`, `public/favicon.png`, `public/favicon.svg`, `public/favicon.jpg`
2. `static/favicon.ico`, `static/favicon.png`, `static/favicon.svg`
3. `public/vite.svg`, `public/next.svg`, `public/nuxt.svg`, `public/svelte.svg`
4. `app/favicon.ico`, `src/app/favicon.ico` (SvelteKit/Next app router)
5. `favicon.ico` (repo root)

When none are present → `null` (the dashboard falls back to a colored-initials
chip). Do not generate or copy icons — if an app lacks one, that's the user's
choice.

### processes

Default: one process named `dev`.

For the single `dev` process, determine:

#### package manager + command

In order, by lockfile present in the project dir:

| Lockfile                                | pm     |
| --------------------------------------- | ------ |
| `bun.lock` / `bun.lockb`                | `bun`  |
| `pnpm-lock.yaml`                        | `pnpm` |
| `yarn.lock`                             | `yarn` |
| `package-lock.json`                     | `npm`  |
| (none of the above, has `package.json`) | `npm`  |

For Python, by `pyproject.toml` tooling:

- `[tool.uv]` or `uv.lock` → `uv run`
- `[tool.poetry]` → `poetry run`
- else → `python -m`

For Rust: `cargo run`. For Go: `go run .`.

#### dev script

From `package.json` `scripts`, in priority order: `dev` > `start:dev` > `start`

> `develop`. If none: leave `command: ""` (the user must edit it manually —
> flag this in your summary). For Python/Rust/Go, the command is the run command
> above plus the main module/bin (use your judgment; if unclear, ask).

The final command is `<pm> run <script>` (e.g. `bun run dev`). Keep it as a
shell string — bunrun runs via `sh -c`, so `&&`, env prefixes, and pipes work
verbatim in the user-edits-the-YAML case.

#### port

**Hint only — bunrun never assigns ports;** this field is a UI convenience and
a fallback for the URL scraper. Set it only when you have a confident signal:

- `PORT=` in `.env` / `.env.example` (highest confidence)
- `package.json` script references a port (e.g. `vite --port 5173`)
- Tight framework default (Vite `5173`, Next `3000`, Nuxt `3000`, SvelteKit
  `5173`) — only when the script invokes that framework directly

Otherwise `null`. Never write `PORT=` to the project's `.env` — that is Phase 3
territory.

#### url / urlPattern / openOnStart

- `url`: always `null` (the scraper resolves the actual URL on start; or the
  user overrides later).
- `urlPattern`: `null` unless you observe a clearly non-standard log line the
  default Vite/Next/generic `localhost:PORT` patterns won't catch. Document why
  in your summary if you set it.
- `openOnStart`: `true` for the primary (frontend-most) process, `false` for
  backend/worker-secondary. When in doubt: `true` for the single process; `false`
  for any added second/third process.

#### Multiple processes

Add a second/third process only when you have strong, unambiguous signals:
explicit `web`/`server`/`worker` script pairs, or a turbo/nx monorepo the user
chose to split (see "Monorepo emphasis" above). Name them by role:
`web`/`server`/`worker`/`api`. Better to under- than over-specify — the user can
add more in the UI later.

### ui

Always write the default for new entries: `ui: { pinned: false, logEnabled: false }`.
On re-scan, **keep** the existing block untouched.

## Writing the file

1. Read the current `data/projects.yaml` (it may not exist — treat as `[]`).
2. Parse with the same parser the server uses, or just match by `id` via regex
   if the file is one-line — the safest approach is to fully parse, mutate in
   memory, and re-serialize in block style.
3. For each discovered project:
   - If `id` exists and `path` matches → update discovered fields, preserve
     `ui`/`category`/`name` (per the rule above).
   - If `id` exists and `path` differs → collision, prompt user (don't clobber).
   - Else → append a new entry with default `ui`.
4. Write atomically: write to `data/projects.yaml.tmp`, then rename to
   `data/projects.yaml`. The server's file watcher debounces 300ms; the server
   ignores reloads triggered by its own writes for 1.5s, but your write is
   external so it will reload — that's correct, the dashboard picks it up with
   running processes preserved (synced by `syncFromConfig` in the server).

**Order of entries:** preserve the existing order. Append new entries at the
end. Do not reorder by "running/pinned/alphabetical" — that sort is the UI's
job.

## Summary to report back to the user

After writing, return a concise summary:

- N scanned, M added, K updated, J skipped (with reasons).
- Per-project table: `id`, `name`, `command`, `port` (or "—"), `favicon`
  (or "—").
- Anything flagged for manual review: missing dev script, monorepo split
  declined, port unresolved, etc.

## Examples

### Single scan

User: "scan ~/koodi/pimio for bunrun"

You: read `~/koodi/pimio/package.json`, see `scripts.dev`, lockfile `bun.lock`,
find `public/favicon.ico`, no `.env`, port hint from vite default `5173`.

Append to `data/projects.yaml`:

```yaml
- id: pimio
  name: Pimio
  path: /Users/you/koodi/pimio
  category: null
  favicon: public/favicon.ico
  envFile: null
  processes:
    - name: dev
      command: bun run dev
      cwd: null
      port: 5173
      url: null
      urlPattern: null
      openOnStart: true
  ui:
    pinned: false
    logEnabled: false
```

### Bulk scan

User: "scan ~/koodi, depth 1"

You walk `~/koodi`'s immediate children, skipping `.cache`/etc. For each child
that matches a project marker, run the per-project procedure. Write all new
entries and update existing ones (preserving `ui`). Then summarize.

## Out of scope

- Editing `data/vault.yaml` — separate concern (Phase 2 `.env` editor + vault).
- Assigning or injecting `PORT=` into `.env` — explicit non-goal; Phase 3 idea.
- Starting the projects — the user does that from the dashboard.
- Generating favicons — if a project lacks one, leave `favicon: null`.
