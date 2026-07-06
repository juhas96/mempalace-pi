export const SAVE_INTERVAL = 15;
export const DEFAULT_MINE_TIMEOUT_MS = 300000;
export const AUTO_SAVE_MARKER = "<mempalace-auto-save>";
export const STOP_BLOCK_REASON = `AUTO-SAVE checkpoint (MemPalace). Save this session's key content:
1. mempalace_diary_write — AAAK-compressed session summary
2. mempalace_add_drawer — verbatim quotes, decisions, code snippets
3. mempalace_kg_add — entity relationships when they matter (optional)
4. mempalace_check_duplicate — optional duplicate check before filing near-identical content
Do NOT write this into host-native memory files or sidecar notes unless the user explicitly asked for that. Continue the conversation after saving.`;
export const PRECOMPACT_BLOCK_REASON = `COMPACTION IMMINENT (MemPalace). Save ALL session content before detailed context is lost:
1. mempalace_diary_write — thorough AAAK-compressed session summary
2. mempalace_add_drawer — ALL verbatim quotes, decisions, code, and important context
3. mempalace_kg_add — important entity relationships and changes (optional)
4. mempalace_check_duplicate — optional duplicate check before filing near-identical content
Be thorough. Save everything to MemPalace, then compact again.`;

export const MEMORY_FILING_TOOLS = [
	"mempalace_diary_write",
	"mempalace_add_drawer",
	"mempalace_kg_add",
	"mempalace_check_duplicate",
] as const;

export const SYSTEM_SUPPORT_TOOLS = [
	"mempalace_hook_settings",
	"mempalace_memories_filed_away",
	"mempalace_reconnect",
] as const;

export const UPSTREAM_DOCUMENTED_MCP_TOOLS = [
	"mempalace_status",
	"mempalace_list_wings",
	"mempalace_list_rooms",
	"mempalace_get_taxonomy",
	"mempalace_search",
	"mempalace_check_duplicate",
	"mempalace_get_aaak_spec",
	"mempalace_add_drawer",
	"mempalace_delete_drawer",
	"mempalace_get_drawer",
	"mempalace_list_drawers",
	"mempalace_update_drawer",
	"mempalace_kg_query",
	"mempalace_kg_add",
	"mempalace_kg_invalidate",
	"mempalace_kg_timeline",
	"mempalace_kg_stats",
	"mempalace_traverse",
	"mempalace_find_tunnels",
	"mempalace_graph_stats",
	"mempalace_create_tunnel",
	"mempalace_list_tunnels",
	"mempalace_delete_tunnel",
	"mempalace_follow_tunnels",
	"mempalace_diary_write",
	"mempalace_diary_read",
	"mempalace_hook_settings",
	"mempalace_memories_filed_away",
	"mempalace_reconnect",
] as const;

export function getMcpPromptGuidelines(toolName: string): string[] | undefined {
	switch (toolName) {
		case "mempalace_diary_write":
			return ["Use after meaningful work or before context loss to store an AAAK-compressed session summary."];
		case "mempalace_add_drawer":
			return ["Use for verbatim quotes, decisions, and code snippets. Preserve exact wording when possible."];
		case "mempalace_kg_add":
			return ["Use for durable relationships and fact changes that should be queryable over time."];
		case "mempalace_check_duplicate":
			return ["Use before filing near-identical content when duplicate risk is high."];
		case "mempalace_hook_settings":
			return ["Use to inspect or tune MemPalace auto-save hook behavior."];
		case "mempalace_memories_filed_away":
			return ["Use to verify whether a recent hook checkpoint successfully filed memories."];
		case "mempalace_reconnect":
			return ["Use after external CLI writes if MemPalace search results look stale."];
		default:
			return undefined;
	}
}

export const CORE_COMMANDS = [
	"mempalace:help",
	"mempalace:init",
	"mempalace:search",
	"mempalace:mine",
	"mempalace:status",
	"mempalace:doctor",
] as const;

export const CORE_TOOLS = [
	"mempalace_instructions",
	"mempalace_init",
	"mempalace_search",
	"mempalace_mine",
	"mempalace_status",
] as const;
