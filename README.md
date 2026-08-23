# MemPalace pi extension

A pi package that brings core MemPalace workflows to pi.

## What it adds

- Slash commands:
  - `/mempalace:help`
  - `/mempalace:init`
  - `/mempalace:search <query>`
  - `/mempalace:mine [path]`
  - `/mempalace:status`
  - `/mempalace:doctor` (custom rendered status panel)
- Agent tools:
  - `mempalace_instructions` (prefers CLI-backed upstream instructions, falls back to bundled help)
  - `mempalace_init`
  - `mempalace_search`
  - `mempalace_mine`
  - `mempalace_status`
- MCP bridge:
  - starts `mempalace-mcp` (or falls back to `python3 -m mempalace.mcp_server`) when available
  - supports custom MCP binary paths via `MEMPALACE_MCP_BIN`
  - enforces bounded MCP startup and request timeouts so stalled MCP calls fail fast instead of hanging the agent indefinitely
  - dynamically exposes the MemPalace MCP tool surface to the agent, including write and system tools when the installed server provides them
  - discovers the same MemPalace tool surface directly from the local Python package using the installed launcher interpreter, so dynamic tools remain available even when the MCP transport is unavailable
  - synthesizes local fallback responses for MemPalace operator/system tools when the installed package does not expose those controls outside MCP
  - uses MCP for `mempalace_status` and `mempalace_search` when possible, with CLI fallback; other dynamically surfaced MemPalace tools fall back to the local Python backend when MCP fails
  - fails gracefully when Python or the `mempalace` Python package is missing, without crashing pi
  - shows an in-app setup notice when MemPalace cannot start because dependencies are missing
- Session hooks:
  - auto-save reminder every 15 non-command user messages using the upstream-style memory filing protocol (`mempalace_diary_write`, `mempalace_add_drawer`, optional `mempalace_kg_add`)
  - explicit UI toasts when auto-save or pre-compaction checkpoints trigger
  - if `mempalace_hook_settings` is available, Pi maps `silent_save=true` to silent autosave checkpoints and `desktop_toast` to Pi toast visibility
  - background auto-ingest on save checkpoints using `MEMPAL_DIR`, current session file directory, or `cwd`
  - synchronous pre-compaction ingest; if that cannot preserve context, Pi falls back to a one-time blocking save reminder

## Requirements

To actually use MemPalace features from Pi, you need:

- Python 3.9+ (or `uv` / `pipx` standalone tools)
- the `mempalace` package installed and available on `PATH` (via `uv tool`, `pipx`, or `pip`)

Typical setup:

```bash
uv tool install mempalace
```

Or with pipx for a per-user isolated installation:

```bash
pipx install mempalace
```

Or with pipx for a system-wide isolated installation:

```bash
pipx install --global mempalace
```

Or with pip into the active Python environment:

```bash
python3 -m pip install mempalace
```

If Python / `mempalace` is not installed, or if the binary/module is missing:

- pi will still start normally
- this extension will still load and register its slash commands/tools
- `mempalace_instructions` will still work because it is bundled in this package
- backend-dependent tools such as status/search/init/mine will be marked unavailable and will return a friendly setup message instead of crashing pi

## Install in pi

### Local package

From the package directory:

```bash
pi install .
```

Or add the local path to `.pi/settings.json` / `~/.pi/agent/settings.json`.

### From npm

```bash
pi install npm:mempalace-pi
```

## Usage

After installation, restart pi or run `/reload`, then use:

- `/mempalace:help`
- `/mempalace:init`
- `/mempalace:status`
- `/mempalace:doctor`
- `/mempalace:search auth token rotation`
- `/mempalace:mine .`

Use `/mempalace:doctor` to see whether CLI/bundled help is available, whether the MCP bridge is connected, whether the MCP circuit breaker is open, whether the local fallback backend is ready, which memory-filing/system tools are reachable, whether recent auto-ingest ran, whether `memories_filed_away` acknowledged a silent checkpoint, whether reconnect was recently needed after CLI writes, which fallback path ran most recently, and which upstream-documented tools are missing from the currently installed MemPalace server.

See [`docs/claude-plugin-parity.md`](docs/claude-plugin-parity.md) for the current Claude-plugin parity matrix and documented Pi-specific deviations.

## Publish to npm

Before publishing, confirm the package name is available:

```bash
npm view mempalace-pi name
```

Then publish:

```bash
npm publish
```

Pi will discover the package through the `pi` manifest in `package.json`.

## Package structure

This package now follows a simple library-style layout:

```text
mempalace-pi/
  src/
    index.ts        # pi extension entrypoint
    commands.ts     # slash commands
    hooks.ts        # session and compaction hooks
    renderers.ts    # custom UI renderers
    runtime.ts      # shared runtime / MCP state
    tools.ts        # core tool registrations
    utils.ts        # CLI helpers and shared utilities
    constants.ts    # package constants
    mcp-client.ts   # internal MCP bridge helper
    python-runtime.ts # isolated uv/pipx Python discovery
  README.md
  LICENSE
  package.json
```

This avoids putting helper modules inside an auto-discovered `extensions/` directory, which can cause pi to try loading non-extension files as extension entrypoints, and keeps the package closer to normal library structure best practices.

## Environment Variables

- `MEMPALACE_MCP_BIN` — override the MCP server executable path.
- `MEMPALACE_PYTHON` — override the Python interpreter used for direct local fallback tools.
- `MEMPALACE_SUSPEND_AUTOSAVE=1` — skip all auto-save mine operations. Use during maintenance (repair, migrate, vacuum).
- `MEMPALACE_MINE_TIMEOUT_MS` — timeout in milliseconds for auto-save mine processes. Default: 300000 (5 minutes). Set to a lower value to kill runaway mines faster, or higher for large directories.

The MCP and local fallback paths discover the Python interpreter from the `mempalace-mcp`/`mempalace` launcher shebang, so custom uv and pipx homes work without hardcoded directory assumptions. Ensure the relevant console-script directory is visible in Pi's `PATH`; use `/mempalace:doctor` to inspect runtime and launcher visibility.

## Notes

This extension includes a built-in MCP bridge for `mempalace.mcp_server`, so Pi agents can use the structured MemPalace tool surface when the MCP server is available. For compatibility, the package keeps CLI-backed fallbacks for setup, mining, instructions, and for status/search if MCP cannot be started, and it can execute dynamically surfaced MemPalace tools directly through the local Python package when the MCP transport fails or is unavailable.

On save checkpoints and pre-compaction, the extension tries to preserve memory by mining the best available target in this order:
1. `MEMPAL_DIR`
2. the current Pi session file directory
3. the current working directory

That keeps Pi close to the upstream Claude plugin's transcript-aware save behavior, while documenting the remaining Pi-specific hook differences in the parity doc.
