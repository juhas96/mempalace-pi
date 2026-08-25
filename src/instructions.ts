const INSTRUCTIONS: Record<string, string> = {
	help: `# MemPalace for Pi

MemPalace gives Pi a persistent, searchable memory palace for projects, conversations, people, and decisions.

## Slash commands
- /mempalace:help — overview of commands, tools, hooks, and architecture
- /mempalace:init — install/setup flow and palace initialization
- /mempalace:search <query> — semantic search across the palace
- /mempalace:mine [path] — mine a project or conversation source
- /mempalace:status — quick palace + graph health summary
- /mempalace:doctor — Pi-specific diagnostics for MCP, CLI, and hook behavior

## Core Pi tools
- mempalace_instructions({ name })
- mempalace_init({ directory })
- mempalace_search({ query, wing?, room?, limit?, max_distance?, context? })
- mempalace_mine({ path, mode?, extract?, wing?, split? })
- mempalace_status()

## Important MCP write tools
When saving memory, prefer these tools when available:
- mempalace_diary_write — AAAK-compressed session summaries
- mempalace_add_drawer — verbatim quotes, decisions, code snippets, important context
- mempalace_kg_add — durable facts/relationships
- mempalace_check_duplicate — duplicate check before filing near-identical content

## Other useful MCP tools
- mempalace_list_wings / mempalace_list_rooms / mempalace_get_taxonomy
- mempalace_kg_query / mempalace_kg_timeline / mempalace_kg_stats
- mempalace_traverse / mempalace_find_tunnels / mempalace_graph_stats
- mempalace_hook_settings / mempalace_memories_filed_away / mempalace_reconnect
  - hook_settings can influence Pi autosave silence/toast behavior when available
  - memories_filed_away can confirm a recent silent checkpoint
  - reconnect can refresh stale MCP state after external or CLI writes

## Save-hook behavior in Pi
- Every 15 non-command user messages, Pi injects a MemPalace save checkpoint.
- Before compaction, Pi first tries to mine conversation context synchronously using the best available target (MEMPAL_DIR, current session file directory, then cwd).
- If synchronous ingest cannot preserve the context, Pi blocks compaction once and asks the agent to file the memory explicitly.

## Recommended flow
1. Run /mempalace:init if MemPalace is not installed/configured yet.
2. Use /mempalace:mine to add project files or conversation exports.
3. Use /mempalace:search before answering questions about prior decisions.
4. During save checkpoints, use diary_write + add_drawer, and kg_add when facts changed.
5. Use /mempalace:doctor when MCP/CLI availability is unclear.`,

	init: `# MemPalace init

Guide the user through a full setup in this order:
1. Verify Python 3.9+ or an isolated tool manager is available.
2. Verify or install the mempalace package.
3. Initialize the target directory with mempalace_init.
4. Verify health with mempalace_status or /mempalace:doctor.

## Notes for Pi
- mempalace_instructions prefers CLI-backed upstream instructions when the mempalace package is installed.
- If MemPalace is missing, Pi still keeps bundled instructions available so setup guidance never disappears.
- Pi handles MCP connection itself, but the user still needs the MemPalace launcher directory visible in Pi's PATH.
- Direct local fallback tools use MEMPALACE_PYTHON when set, then the interpreter from a mempalace-mcp/mempalace launcher, then python3/python.

## Supported isolated installations
\`\`\`bash
uv tool install mempalace
pipx install mempalace
pipx install --global mempalace
\`\`\`
Custom uv and pipx homes are supported when their console-script bin directory is visible in Pi's PATH.

## Troubleshooting order
- MemPalace / Python missing → install with uv tool install mempalace, pipx install mempalace, pipx install --global mempalace, or python3 -m pip install mempalace
- mempalace package missing → confirm the mempalace-mcp/mempalace launcher is on PATH or set MEMPALACE_MCP_BIN
- Pi sees a different interpreter/PATH than the terminal → compare with /mempalace:doctor
- direct local fallback cannot import mempalace → set MEMPALACE_PYTHON to the isolated environment's Python interpreter
- MCP startup failing after install → inspect /mempalace:doctor stderr and retry`,

	search: `# MemPalace search

## Search workflow
1. Start with mempalace_search using a natural-language query.
2. If results are broad or the wing/room is unclear, use taxonomy tools first:
   - mempalace_list_wings
   - mempalace_list_rooms
   - mempalace_get_taxonomy
3. Present results with source attribution (wing, room, and similarity/context when available).
4. If the topic spans domains, consider graph tools:
   - mempalace_traverse
   - mempalace_find_tunnels

## Pi fallback
If MCP is unavailable, Pi falls back to the MemPalace CLI for mempalace_search.

## Output expectations
- Include the source wing and room.
- Prefer verbatim snippets when possible.
- Suggest a narrower follow-up search when many results match.`,

	mine: `# MemPalace mine

## Mining workflow
1. Clarify what the source is:
   - project directory
   - conversation export(s)
2. Choose the right mode:
   - project
   - convos
   - convos + extract general for auto-classification
3. If inputs are huge, consider split or split dry-run before mining.
4. Run mempalace_mine.
5. Suggest follow-up verification with /mempalace:search or /mempalace:status.

## Pi-specific notes
- Pi save hooks may also auto-run mempalace mine in the background.
- Auto-ingest target priority is: MEMPAL_DIR → current session file directory → cwd.
- Explicit diary_write/add_drawer filing is still preferred for high-value session context, quotes, and decisions.`,

	status: `# MemPalace status

## Status workflow
1. Use mempalace_status for the core palace overview.
2. If MCP tools are available, also use:
   - mempalace_kg_stats
   - mempalace_graph_stats
3. Summarize the state briefly:
   - wings / rooms / drawers / total memories
   - knowledge graph health
   - graph/tunnel health
4. Suggest one next action based on the current state.

## Pi diagnostics to mention when relevant
- whether the MCP bridge is connected
- whether CLI fallback is working
- whether save-path tools like diary_write/add_drawer are available
- whether recent auto-ingest or save hooks have run
- whether memories_filed_away acknowledged a recent silent checkpoint
- whether reconnect was recently needed after CLI/external writes

If status itself fails, direct the user to /mempalace:doctor.`,
};

export function getBundledInstructions(name: string): string {
	return INSTRUCTIONS[name] ?? INSTRUCTIONS.help;
}
