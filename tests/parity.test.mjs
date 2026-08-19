import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canForegroundIngestSatisfyPrecompact, chooseAutoIngestTarget, describeAutoIngestState } from "../src/auto-ingest-policy.js";
import { getDefaultPiHookSettings, normalizeHookSettingsPayload, shouldShowHookToast, shouldUseSilentSave } from "../src/hook-settings-policy.js";

function read(path) {
	return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("save prompts follow the upstream memory filing protocol", () => {
	const constants = read("src/constants.ts");
	for (const needle of [
		"mempalace_diary_write",
		"mempalace_add_drawer",
		"mempalace_kg_add",
		"mempalace_check_duplicate",
	]) {
		assert.match(constants, new RegExp(needle));
	}
});

test("instructions tool prefers CLI-backed upstream instructions with bundled fallback", () => {
	const tools = read("src/tools.ts");
	assert.match(tools, /runMemPalace\(pi, \["instructions", params\.name\]/);
	assert.match(tools, /source: "cli"/);
	assert.match(tools, /source: "bundled"/);
});

test("auto-ingest target selection prefers env then session then cwd", () => {
	assert.deepEqual(chooseAutoIngestTarget({ envTarget: "/env", sessionTarget: "/session", cwdTarget: "/cwd" }), {
		targetPath: "/env",
		targetSource: "env",
	});
	assert.deepEqual(chooseAutoIngestTarget({ sessionTarget: "/session", cwdTarget: "/cwd" }), {
		targetPath: "/session",
		targetSource: "session",
	});
	assert.deepEqual(chooseAutoIngestTarget({ cwdTarget: "/cwd" }), {
		targetPath: "/cwd",
		targetSource: "cwd",
	});
	assert.deepEqual(chooseAutoIngestTarget({}), {});
});

test("precompact only treats env or session ingest as sufficient preservation", () => {
	assert.equal(canForegroundIngestSatisfyPrecompact({ started: true, targetSource: "env", result: { code: 0 } }), true);
	assert.equal(canForegroundIngestSatisfyPrecompact({ started: true, targetSource: "session", result: { code: 0 } }), true);
	assert.equal(canForegroundIngestSatisfyPrecompact({ started: true, targetSource: "cwd", result: { code: 0 } }), false);
	assert.equal(canForegroundIngestSatisfyPrecompact({ started: true, targetSource: "session", result: { code: 1 } }), false);
	assert.equal(canForegroundIngestSatisfyPrecompact({ started: false, targetSource: "session", result: { code: 0 } }), false);
});

test("doctor labels background auto-ingest as queued instead of implying success", () => {
	assert.equal(describeAutoIngestState({ started: true, mode: "background" }), "queued (background)");
	assert.equal(describeAutoIngestState({ started: true, mode: "foreground", result: { code: 0 } }), "exit 0");
});

test("hook settings map upstream fields onto Pi behavior with sensible defaults", () => {
	assert.deepEqual(getDefaultPiHookSettings(), { silent_save: false, desktop_toast: true });
	assert.deepEqual(normalizeHookSettingsPayload({ settings: { silent_save: true, desktop_toast: false } }), {
		silent_save: true,
		desktop_toast: false,
	});
	assert.equal(shouldUseSilentSave({ silent_save: true }), true);
	assert.equal(shouldUseSilentSave(undefined), false);
	assert.equal(shouldShowHookToast({ desktop_toast: false }), false);
	assert.equal(shouldShowHookToast(undefined), true);
});

test("precompact first attempts synchronous ingest and only blocks on fallback", () => {
	const hooks = read("src/hooks.ts");
	assert.match(hooks, /maybeAutoIngest\(pi, ctx, event\.signal, "foreground"\)/);
	assert.match(hooks, /canForegroundIngestSatisfyPrecompact\(ingest\)/);
	assert.match(hooks, /return \{ cancel: true \}/);
});

test("hook checkpoints honor hook settings semantics and surface toasts", () => {
	const hooks = read("src/hooks.ts");
	assert.match(hooks, /runtime\.refreshHookSettings/);
	assert.match(hooks, /runtime\.acknowledgeMemoriesFiledAway/);
	assert.match(hooks, /runtime\.reconnectPalace/);
	assert.match(hooks, /MemPalace auto-save checkpoint queued silently/);
	assert.match(hooks, /shouldUseSilentSave\(hookSettings\)/);
	assert.match(hooks, /shouldShowHookToast\(hookSettings\)/);
	assert.match(hooks, /MemPalace pre-compact ingest completed/);
	assert.match(hooks, /MemPalace pre-compact save checkpoint triggered/);
});

test("doctor reports parity-sensitive MCP visibility", () => {
	const commands = read("src/commands.ts");
	assert.match(commands, /memory filing tools available:/);
	assert.match(commands, /system support tools available:/);
	assert.match(commands, /upstream documented tools missing from current MCP server:/);
	assert.match(commands, /describeAutoIngestState/);
	assert.match(commands, /hook settings: silent_save=/);
	assert.match(commands, /memories filed away:/);
	assert.match(commands, /last reconnect:/);
});

test("successful MCP connection auto-registers discovered tools and caches hook settings", () => {
	const runtime = read("src/runtime.ts");
	assert.match(runtime, /this\.registerDiscoveredMcpTools\(\)/);
	assert.match(runtime, /registerDiscoveredFallbackTools/);
	assert.match(runtime, /async refreshHookSettings/);
	assert.match(runtime, /"mempalace_hook_settings"/);
	assert.match(runtime, /async acknowledgeMemoriesFiledAway/);
	assert.match(runtime, /async reconnectPalace/);
});

test("CLI write tools trigger reconnect after successful writes", () => {
	const tools = read("src/tools.ts");
	assert.match(tools, /await runtime\.reconnectPalace\(signal\)/);
	assert.match(tools, /MemPalace reconnect: refreshed MCP state after CLI mine/);
});


test("MCP client enforces internal connect and request timeouts and attempts mempalace-mcp binary", () => {
	const mcpClient = read("src/mcp-client.ts");
	assert.match(mcpClient, /\["mempalace-mcp", \[\]\]/);
	assert.match(mcpClient, /DEFAULT_MCP_CONNECT_TIMEOUT_MS/);
	assert.match(mcpClient, /DEFAULT_MCP_REQUEST_TIMEOUT_MS/);
	assert.match(mcpClient, /timed out after \$\{timeoutMs\}ms during initialize\/tools\/list/);
	assert.match(mcpClient, /MemPalace MCP request timed out after \$\{timeoutMs\}ms: \$\{method\}/);
});


test("local backend discovers tools from MemPalace Python TOOLS and includes synthetic system-tool fallbacks", () => {
	const backend = read("src/local-backend.ts");
	assert.match(backend, /import mempalace\.mcp_server as mcp_server/);
	assert.match(backend, /_restore_stdout/);
	assert.match(backend, /TOOLS = mcp_server\.TOOLS/);
	assert.match(backend, /spec.get\("input_schema"\)/);
	assert.match(backend, /tool\["handler"\]\(\*\*params\)/);
	assert.match(backend, /fallback_supported/);
	assert.match(backend, /mempalace_hook_settings/);
	assert.match(backend, /mempalace_memories_filed_away/);
	assert.match(backend, /mempalace_reconnect/);
	assert.match(backend, /mergeSyntheticTools/);
});


test("MCP client keeps stdout reader open after startup for later tool calls", () => {
	const mcpClient = read("src/mcp-client.ts");
	assert.match(mcpClient, /private stdoutReader\?: readline\.Interface/);
	assert.match(mcpClient, /this\.stdoutReader = rl/);
	assert.doesNotMatch(mcpClient, /if \(startupComplete\) \{\s*rl\.close\(\);\s*\}/);
});


test("runtime opens an MCP circuit breaker for transport failures, keeps tool errors local, and routes dynamic tools through fallback", () => {
	const runtime = read("src/runtime.ts");
	const mcpClient = read("src/mcp-client.ts");
	assert.match(runtime, /mcpCircuitOpen = false/);
	assert.match(runtime, /tripMcpCircuit/);
	assert.match(runtime, /const kind = getMcpErrorKind\(error\)/);
	assert.match(runtime, /if \(kind === "transport"\)/);
	assert.match(runtime, /runSyntheticLocalFallbackTool/);
	assert.match(runtime, /return this\.runFallbackTool\(tool\.name/);
	assert.match(runtime, /registerDynamicTool/);
	assert.match(runtime, /recordFallback\(/);
	assert.match(mcpClient, /createTaggedMcpError/);
	assert.match(mcpClient, /getMcpErrorKind/);
	assert.match(mcpClient, /"transport"/);
	assert.match(mcpClient, /"tool"/);
});


test("doctor and session start report fallback backend readiness and circuit state", () => {
	const commands = read("src/commands.ts");
	const hooks = read("src/hooks.ts");
	const renderers = read("src/renderers.ts");
	assert.match(commands, /mcp circuit:/);
	assert.match(commands, /local fallback discovery:/);
	assert.match(commands, /fallback-registered dynamic tools:/);
	assert.match(commands, /last fallback:/);
	assert.match(hooks, /ensureLocalFallbackTools/);
	assert.match(hooks, /MemPalace local fallback ready/);
	assert.match(renderers, /reportsMissingItems/);
	assert.match(renderers, /!line\.endsWith\(": none"\)/);
});


test("status and search tools delegate fallback handling through the shared runtime", () => {
	const tools = read("src/tools.ts");
	assert.match(tools, /runtime\.runFallbackTool\("mempalace_status"/);
	assert.match(tools, /runtime\.runFallbackTool\(\s*"mempalace_search"/);
});

test("repo docs include Claude-plugin parity documentation", () => {
	const readme = read("README.md");
	const parity = read("docs/claude-plugin-parity.md");
	assert.match(readme, /docs\/claude-plugin-parity\.md/);
	assert.match(parity, /Parity matrix/);
	assert.match(parity, /Intentional Pi-specific deviations/);
});
