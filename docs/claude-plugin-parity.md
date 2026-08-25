# MemPalace Claude-plugin parity for Pi

This document tracks how `mempalace-pi` aligns with the upstream MemPalace Claude plugin (`MemPalace/mempalace/.claude-plugin`) and where Pi intentionally differs because of host-runtime constraints.

## Goal

Bring `mempalace-pi` as close as practical to upstream MemPalace behavior, especially for:
- memory filing during save checkpoints
- hook semantics
- instruction/help flows
- MCP tool discoverability
- operator diagnostics and support flows

## Parity matrix

| Area | Upstream Claude plugin | Pi status | Resolution |
|---|---|---:|---|
| Slash commands | help/init/search/mine/status | Aligned | Keep command names aligned; Pi also keeps `/mempalace:doctor` for Pi diagnostics. |
| MCP connection | plugin config points at `python3 -m mempalace.mcp_server` | Aligned | Pi starts `mempalace-mcp` (with fallback to `python3 -m mempalace.mcp_server` or `MEMPALACE_MCP_BIN`) internally and dynamically registers discovered tools. Local direct-Python fallback uses `MEMPALACE_PYTHON`, then the interpreter from an installed launcher, then system Python. This supports uv tool, per-user pipx, and global pipx without fixed home paths. |
| Instruction source | `mempalace instructions <name>` via upstream docs/CLI | Adapted | Pi now prefers CLI-backed `mempalace instructions <name>` and falls back to bundled instructions if the package is unavailable. |
| Save checkpoint cadence | stop hook every 15 human messages | Aligned | Pi keeps the 15-message cadence. |
| Save checkpoint wording | explicit `diary_write` + `add_drawer` + optional `kg_add` guidance | Aligned | Pi save prompts now call out the same write-path tools and duplicate-check guidance. |
| Precompact preservation | upstream hook code mines synchronously before compaction | Adapted | Pi now attempts synchronous `mempalace mine` before compaction. If that cannot preserve context, Pi falls back to a one-time blocking save prompt. |
| Auto-ingest target | `MEMPAL_DIR`, else transcript directory | Adapted | Pi target priority is `MEMPAL_DIR` → session file directory → `cwd`. Pi does not expose Claude's transcript-path hook payload directly. |
| MCP write-tool discoverability | full server tool surface available to the agent | Aligned | Pi dynamically exposes all discovered MCP tools and adds prompt guidance for key save/system tools. |
| Upstream documented tool parity | 29 documented MCP tools in current docs | Adapted | Pi exposes whatever the installed MemPalace server offers and reports documented-tool gaps in `/mempalace:doctor`. |
| System/operator tools | hook_settings, memories_filed_away, reconnect | Adapted | Pi surfaces them via dynamic MCP registration; hook_settings now actively influences Pi autosave/toast behavior, memories_filed_away is consulted for silent checkpoint confirmation/doctor output, and reconnect is used after CLI/foreground ingest writes plus surfaced in diagnostics. |
| Status workflow | palace stats + KG/graph stats when available | Adapted | Pi command guidance now asks for KG/graph context too when the tools exist. |
| Hook implementation source | Claude wrappers shell out to `mempalace hook run` | Documented deviation | Pi extension hooks run inside Pi's extension event system. We mirror upstream policy where possible instead of shelling through a Claude-specific hook interface. |
| Host-native auto-memory avoidance | upstream warns not to write to Claude native memory | Adapted | Pi prompts warn against using host-native memory sidecars unless explicitly requested. |

## Intentional Pi-specific deviations

### 1. Hook transport differs
Upstream Claude plugin hooks are shell scripts invoked by Claude Code. Pi hooks run inside the TypeScript extension event system (`agent_end`, `session_before_compact`, etc.).

**Why:** Pi provides native extension hooks, not Claude hook payload contracts.

**Policy:** mimic the same memory-preservation behavior and tool guidance, even when the transport differs.

### 2. Transcript path fallback is approximated
Upstream hook code gets a transcript path from the harness. Pi does not provide that same hook payload shape.

**Pi fallback order:**
1. `MEMPAL_DIR`
2. current session file directory
3. `ctx.cwd`

This is the closest Pi-native approximation of upstream transcript-aware mining.

**Important safety rule:** only `env` and `session` targets count as sufficient preservation for allowing compaction to continue automatically. A successful `cwd` mine is treated as a best-effort aid, not proof that the active conversation transcript was preserved.

### 3. Precompact fallback stays safer than upstream
Current upstream Python hook code mines synchronously and allows compaction through. Pi does the same when sync ingest succeeds.

If sync ingest cannot run successfully, Pi falls back to a blocking save prompt so the model can still file memories explicitly. This is a safety-oriented Pi deviation.

### 4. Hook settings are adapted to Pi semantics
When `mempalace_hook_settings` is available, Pi applies it with Pi-native semantics:
- `silent_save=true` suppresses the routine autosave chat injection and keeps the checkpoint silent/non-blocking
- `desktop_toast` controls whether Pi shows UI toasts for autosave/precompact checkpoint events

Pi still keeps the stronger precompact safety rule: if foreground preservation is not sufficient, compaction is blocked once even when `silent_save=true`.

### 5. Silent checkpoint confirmation and reconnect are Pi-native integrations
Pi now uses additional operator tools when available:
- `mempalace_memories_filed_away` is consulted to acknowledge recent silent checkpoints and is surfaced in `/mempalace:doctor`
- `mempalace_reconnect` is invoked after successful CLI/foreground-ingest writes to reduce stale MCP state risk, and the latest reconnect status is shown in diagnostics

## Contractual parity expectations

These behaviors should not regress without updating this document and the parity tests:

1. Save checkpoints mention `mempalace_diary_write` and `mempalace_add_drawer`.
2. Pi prefers CLI-backed instructions and falls back gracefully.
3. Auto-ingest does not depend solely on `MEMPAL_DIR`.
4. `/mempalace:doctor` reports save-path and documented-tool parity information.
5. README/help copy reflects the aligned save workflow, operator tools, and uv/pipx runtime discovery.

## Related beads

- `mempalace-pi-0sq.1` parity matrix and target-alignment spec
- `mempalace-pi-0sq.2` save prompt alignment
- `mempalace-pi-0sq.3` hook behavior alignment
- `mempalace-pi-0sq.4` transcript-aware auto-ingest parity
- `mempalace-pi-0sq.5` instruction sync
- `mempalace-pi-0sq.6` MCP tool discoverability
- `mempalace-pi-0sq.7` operator/system-tool parity
- `mempalace-pi-0sq.8` regression tests and release docs
