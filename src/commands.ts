import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CORE_COMMANDS, CORE_TOOLS, MEMORY_FILING_TOOLS, SYSTEM_SUPPORT_TOOLS, UPSTREAM_DOCUMENTED_MCP_TOOLS } from "./constants";
import type { MemPalaceRuntime } from "./runtime";
import { describeAutoIngestState } from "./auto-ingest-policy.js";
import {
	getMemPalaceSetupGuidance,
	getMemPalaceSetupGuidanceFromExec,
	probePythonEnvironment,
	quoteArg,
	refineSetupGuidance,
	runMemPalace,
	sendUserMessage,
	summarizePythonProbe,
	truncate,
} from "./utils";
import { discoverMemPalacePythonCandidates } from "./python-runtime.ts";

function queuePrompt(pi: ExtensionAPI, ctx: ExtensionContext, text: string) {
	sendUserMessage(pi, ctx, text);
	ctx.ui.notify("MemPalace request sent", "info");
}

export function registerCommands(pi: ExtensionAPI, runtime: MemPalaceRuntime) {
	pi.registerCommand("mempalace:help", {
		description: "Show MemPalace help and available workflows",
		handler: async (_args, ctx) => {
			queuePrompt(
				pi,
				ctx,
				"Use the mempalace_instructions tool with name \"help\". Then give me a concise overview of the available MemPalace slash commands, MCP tools, save hooks, and palace architecture.",
			);
		},
	});

	pi.registerCommand("mempalace:init", {
		description: "Set up MemPalace for the current project or a target directory",
		handler: async (args, ctx) => {
			const directory = args.trim() || ctx.cwd;
			queuePrompt(
				pi,
				ctx,
				[
					`Set up MemPalace for this directory: ${quoteArg(directory)}.`,
					"Use the mempalace_instructions tool with name \"init\" for the guided flow, including install, MCP setup, initialization, and verification.",
					"Use mempalace_init when you are ready to initialize the directory.",
				].join(" "),
			);
		},
	});

	pi.registerCommand("mempalace:search", {
		description: "Search memories in MemPalace",
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /mempalace:search <query>", "warning");
				return;
			}
			queuePrompt(
				pi,
				ctx,
				`Search my MemPalace for ${quoteArg(query)}. Use mempalace_search directly, discover taxonomy first if you need wing/room resolution, and summarize results with source attribution and relevant room/wing context.`,
			);
		},
	});

	pi.registerCommand("mempalace:mine", {
		description: "Mine a project directory or conversation export into MemPalace",
		handler: async (args, ctx) => {
			const source = args.trim() || ctx.cwd;
			queuePrompt(
				pi,
				ctx,
				[
					`Mine this source into MemPalace: ${quoteArg(source)}.`,
					"Use the mempalace_instructions tool with name \"mine\" if you need the guided flow.",
					"Use mempalace_mine, ask whether the source is project or conversations if ambiguous, and suggest split/dry-run when large files are likely.",
				].join(" "),
			);
		},
	});

	pi.registerCommand("mempalace:status", {
		description: "Show the current MemPalace status",
		handler: async (_args, ctx) => {
			queuePrompt(
				pi,
				ctx,
				"Use mempalace_status for the palace overview. If mempalace_kg_stats or mempalace_graph_stats are available, include them in a quick-glance status summary and suggest one relevant next action.",
			);
		},
	});

	pi.registerCommand("mempalace:doctor", {
		description: "Check whether the MemPalace pi extension, MCP bridge, and CLI are working",
		handler: async (_args, ctx) => {
			const lines: string[] = [];
			const commands = pi.getCommands().map((command) => command.name);
			const missingCommands = [...CORE_COMMANDS].filter((name) => !commands.includes(name));
			lines.push(`extension commands: ${missingCommands.length === 0 ? "ok" : `missing ${missingCommands.join(", ")}`}`);

			const tools = pi.getAllTools().map((tool) => tool.name);
			const missingTools = [...CORE_TOOLS].filter((name) => !tools.includes(name));
			lines.push(`core extension tools: ${missingTools.length === 0 ? "ok" : `missing ${missingTools.join(", ")}`}`);

			const runtimeCandidates = await discoverMemPalacePythonCandidates();
			const pythonProbe = await probePythonEnvironment(pi).catch(() => undefined);

			const { tools: localTools } = await runtime.ensureLocalFallbackTools();
			const { client, tools: mcpTools } = await runtime.ensureMcpConnected();
			await runtime.refreshHookSettings();
			const filedAway = await runtime.acknowledgeMemoriesFiledAway();
			runtime.registerDiscoveredMcpTools();
			runtime.registerDiscoveredFallbackTools();
			lines.push(`mcp bridge: ${client ? "ok" : `unavailable (${runtime.mcpStartupError || "unknown error"})`}`);
			lines.push(`mcp circuit: ${runtime.mcpCircuitOpen ? `open (${runtime.mcpCircuitReason || "unknown reason"})${runtime.mcpCircuitOpenedAt ? ` since ${runtime.mcpCircuitOpenedAt}` : ""}` : "closed"}`);
			const mcpGuidance = refineSetupGuidance(getMemPalaceSetupGuidance(runtime.mcpStartupError), pythonProbe);
			if (mcpGuidance) {
				lines.push(`mcp setup required: ${mcpGuidance}`);
			}
			lines.push(`MemPalace Python candidates: ${runtimeCandidates.join(", ") || "none"}`);
			if (pythonProbe) {
				lines.push(`python visibility in Pi:\n${summarizePythonProbe(pythonProbe).join("\n")}`);
			}
			lines.push(`local fallback discovery: ${localTools.length > 0 ? `ok (${localTools.length} tools)` : `unavailable (${runtime.localFallbackError || "no tools discovered"})`}`);
			lines.push(`fallback-registered dynamic tools: ${[...runtime.registeredFallbackTools].sort().join(", ") || "none"}`);
			if (client) {
				const toolNames = mcpTools.map((tool) => tool.name).sort();
				const missingDocumented = UPSTREAM_DOCUMENTED_MCP_TOOLS.filter((name) => !toolNames.includes(name));
				const availableMemoryFiling = MEMORY_FILING_TOOLS.filter((name) => toolNames.includes(name));
				const availableSystemTools = SYSTEM_SUPPORT_TOOLS.filter((name) => toolNames.includes(name));
				lines.push(`mcp command: ${client.getCommandLine()}`);
				lines.push(`mcp tool count: ${mcpTools.length}`);
				lines.push(`mcp registered dynamically: ${[...runtime.registeredMcpTools].sort().join(", ") || "none"}`);
				lines.push(`mcp disabled tools: ${[...runtime.disabledMcpTools].sort().join(", ") || "none"}`);
				lines.push(`memory filing tools available: ${availableMemoryFiling.join(", ") || "none"}`);
				lines.push(`system support tools available: ${availableSystemTools.join(", ") || "none"}`);
				lines.push(`upstream documented tools missing from current MCP server: ${missingDocumented.join(", ") || "none"}`);
			} else if (runtime.getMcpStderr()) {
				lines.push(`mcp stderr:\n${truncate(runtime.getMcpStderr(), 2000)}`);
			}

			if (runtime.lastMcpToolError) {
				lines.push(`last mcp tool error: ${runtime.lastMcpToolError}`);
			}
			if (runtime.lastFallback) {
				lines.push(
					`last fallback: ${runtime.lastFallback.toolName} via ${runtime.lastFallback.transport} (${runtime.lastFallback.success ? "success" : "failed"})${runtime.lastFallback.reason ? ` — ${runtime.lastFallback.reason}` : ""} checked ${runtime.lastFallback.checkedAt}`,
				);
			}
			lines.push(
				`hook settings: silent_save=${runtime.hookSettings.silent_save}, desktop_toast=${runtime.hookSettings.desktop_toast} (source=${runtime.hookSettings.source}, updated=${runtime.hookSettings.updatedAt})`,
			);

			lines.push(`cwd: ${ctx.cwd}`);
			lines.push(`session file: ${ctx.sessionManager.getSessionFile?.() || "ephemeral"}`);
			lines.push(`MEMPAL_DIR: ${process.env.MEMPAL_DIR?.trim() || "not set"}`);
			if (runtime.lastAutoIngest?.started) {
				const target = `${runtime.lastAutoIngest.targetSource}:${runtime.lastAutoIngest.targetPath}`;
				const status = describeAutoIngestState(runtime.lastAutoIngest);
				lines.push(`last auto-ingest: ${target} (${status} at ${runtime.lastAutoIngest.timestamp})`);
			}
			if (filedAway) {
				lines.push(`memories filed away: ${filedAway.status} (${filedAway.message || "no message"}) checked ${filedAway.checkedAt}`);
			}
			if (runtime.lastReconnect) {
				lines.push(`last reconnect: ${runtime.lastReconnect.success ? runtime.lastReconnect.message || "success" : runtime.lastReconnect.error || "failed"} checked ${runtime.lastReconnect.checkedAt}`);
			}

			const versionRun = await runMemPalace(pi, ["--help"]);
			lines.push(`cli probe: ${versionRun.result.code === 0 ? "ok" : `failed (exit ${versionRun.result.code})`}`);
			lines.push(`cli command: ${versionRun.command.join(" ")}`);
			const cliGuidance = refineSetupGuidance(getMemPalaceSetupGuidanceFromExec(versionRun.command, versionRun.result), pythonProbe);
			if (cliGuidance) {
				lines.push(`cli setup required: ${cliGuidance}`);
			}
			if (versionRun.result.code !== 0 && versionRun.result.stderr.trim()) {
				lines.push(`cli stderr: ${truncate(versionRun.result.stderr.trim(), 1000)}`);
			}

			const statusRun = await runMemPalace(pi, ["status"]);
			lines.push(`cli status probe: ${statusRun.result.code === 0 ? "ok" : `failed (exit ${statusRun.result.code})`}`);
			if (statusRun.result.stdout.trim()) {
				lines.push(`status stdout:\n${truncate(statusRun.result.stdout.trim(), 2000)}`);
			}
			if (statusRun.result.code !== 0 && statusRun.result.stderr.trim()) {
				lines.push(`status stderr:\n${truncate(statusRun.result.stderr.trim(), 2000)}`);
			}

			const backendUnavailable = !client && localTools.length === 0 && (!!mcpGuidance || !!cliGuidance || !!runtime.localFallbackError);
			const unavailableTools = [
				"mempalace_status",
				"mempalace_init",
				"mempalace_search",
				"mempalace_mine",
			].filter(() => backendUnavailable);
			lines.push(`bundled tools always available: mempalace_instructions`);
			lines.push(`backend-dependent tools: ${unavailableTools.length > 0 ? `unavailable (${unavailableTools.join(", ")})` : "ok"}`);

			const ok =
				missingCommands.length === 0 &&
				missingTools.length === 0 &&
				versionRun.result.code === 0 &&
				statusRun.result.code === 0 &&
				(!!client || localTools.length > 0);
			const report = lines.join("\n\n");

			pi.sendMessage({
				customType: "mempalace-doctor",
				content: report,
				display: true,
				details: { ok },
			});

			if (ctx.hasUI) {
				ctx.ui.notify("MemPalace doctor completed", ok ? "success" : "warning");
			}
			console.log(report);
		},
	});
}
