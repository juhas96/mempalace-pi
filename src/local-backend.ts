import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpToolDefinition } from "./mcp-client";
import type { ExecResult } from "./utils";
import { discoverMemPalacePythonCandidates } from "./python-runtime.ts";

export type LocalMemPalaceToolCall = {
	command: string[];
	result: ExecResult;
	parsed: unknown;
	text: string;
};

const SYNTHETIC_LOCAL_TOOLS: McpToolDefinition[] = [
	{
		name: "mempalace_hook_settings",
		description: "Inspect MemPalace auto-save hook settings.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "mempalace_memories_filed_away",
		description: "Check whether a recent silent checkpoint likely ran.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "mempalace_reconnect",
		description: "Refresh MemPalace client state after external writes.",
		inputSchema: { type: "object", properties: {} },
	},
];

const DISCOVER_LOCAL_TOOLS_SCRIPT = `
import json
import os
import sys
import mempalace.mcp_server as mcp_server

if hasattr(mcp_server, "_restore_stdout"):
    mcp_server._restore_stdout()
else:
    real_fd = getattr(mcp_server, "_REAL_STDOUT_FD", None)
    if real_fd is not None:
        os.dup2(real_fd, 1)
    sys.stdout = getattr(mcp_server, "_REAL_STDOUT", sys.__stdout__)

TOOLS = mcp_server.TOOLS
print(json.dumps({
    "tools": [
        {
            "name": name,
            "description": spec.get("description"),
            "inputSchema": spec.get("input_schema") or {"type": "object", "properties": {}},
        }
        for name, spec in TOOLS.items()
    ]
}, ensure_ascii=False, default=str))
`;

const CALL_LOCAL_TOOL_SCRIPT = `
import json
import os
import sys
import mempalace.mcp_server as mcp_server

if hasattr(mcp_server, "_restore_stdout"):
    mcp_server._restore_stdout()
else:
    real_fd = getattr(mcp_server, "_REAL_STDOUT_FD", None)
    if real_fd is not None:
        os.dup2(real_fd, 1)
    sys.stdout = getattr(mcp_server, "_REAL_STDOUT", sys.__stdout__)

TOOLS = mcp_server.TOOLS

tool_name = sys.argv[1]
payload_path = sys.argv[2]
with open(payload_path, encoding="utf-8") as fh:
    params = json.load(fh)

tool = TOOLS.get(tool_name)
if not tool:
    print(json.dumps({
        "success": False,
        "fallback_supported": False,
        "error": f"No local MemPalace backend for {tool_name}",
    }, ensure_ascii=False, default=str))
    raise SystemExit(4)

try:
    result = tool["handler"](**params)
except Exception as exc:
    print(json.dumps({
        "success": False,
        "fallback_supported": True,
        "error": str(exc),
        "exception_type": type(exc).__name__,
    }, ensure_ascii=False, default=str))
    raise SystemExit(5)

print(json.dumps(result, ensure_ascii=False, default=str))
`;

export async function discoverLocalMemPalaceTools(pi: ExtensionAPI, signal?: AbortSignal): Promise<{
	command: string[];
	result: ExecResult;
	tools: McpToolDefinition[];
}> {
	const { command, result } = await runPythonMemPalaceScript(pi, DISCOVER_LOCAL_TOOLS_SCRIPT, [], signal);
	const parsed = parseStructuredOutput(result.stdout);
	const tools =
		parsed && typeof parsed === "object" && Array.isArray((parsed as { tools?: unknown[] }).tools)
			? (((parsed as { tools: unknown[] }).tools as unknown[]).filter(isToolDefinition) as McpToolDefinition[])
			: [];
	return { command, result, tools: mergeSyntheticTools(tools) };
}

export async function callLocalMemPalaceTool(
	pi: ExtensionAPI,
	toolName: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<LocalMemPalaceToolCall> {
	const tempDir = await mkdtemp(join(tmpdir(), "mempalace-pi-"));
	const payloadPath = join(tempDir, "payload.json");
	try {
		await writeFile(payloadPath, JSON.stringify(params), "utf8");
		const { command, result } = await runPythonMemPalaceScript(pi, CALL_LOCAL_TOOL_SCRIPT, [toolName, payloadPath], signal);
		const parsed = parseStructuredOutput(result.stdout);
		return {
			command,
			result,
			parsed,
			text: formatStructuredToolText(parsed, result),
		};
	} finally {
		await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function runPythonMemPalaceScript(
	pi: ExtensionAPI,
	script: string,
	args: string[],
	signal?: AbortSignal,
): Promise<{ command: string[]; result: ExecResult }> {
	const candidates = (await discoverMemPalacePythonCandidates()).map((command) => [command, ["-c", script, ...args]] as [string, string[]]);

	let last: { command: string[]; result: ExecResult } | undefined;
	let missingModule: { command: string[]; result: ExecResult } | undefined;
	for (const [command, commandArgs] of candidates) {
		const result = (await pi.exec(command, commandArgs, { signal })) as ExecResult;
		last = { command: [command, ...commandArgs], result };
		if (result.code === 0) return last;

		const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
		const missingCommand =
			combined.includes("command not found") ||
			combined.includes("not recognized as an internal or external command") ||
			combined.includes("no such file or directory");
		const missingMemPalaceModule = /no module named ['"]?mempalace['"]?/i.test(combined);

		if (missingMemPalaceModule) {
			if (!missingModule) missingModule = last;
			continue;
		}
		if (!missingCommand) return last;
	}

	if (missingModule) {
		const attempted = candidates.map(([cmd]) => cmd).join(", ");
		const appendedStderr = `${missingModule.result.stderr.trim()}\n\nAttempted MemPalace Python interpreters: ${attempted}`.trim();
		return {
			command: missingModule.command,
			result: { ...missingModule.result, stderr: appendedStderr },
		};
	}
	if (!last) throw new Error("No local MemPalace backend commands were attempted.");
	return last;
}

function parseStructuredOutput(stdout: string): unknown {
	const text = stdout.trim();
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function formatStructuredToolText(parsed: unknown, result: ExecResult): string {
	if (typeof parsed === "string") return parsed;
	if (parsed !== undefined) return JSON.stringify(parsed, null, 2);
	const stderr = result.stderr.trim();
	return stderr || `MemPalace local backend exited with code ${result.code}`;
}

function mergeSyntheticTools(tools: McpToolDefinition[]): McpToolDefinition[] {
	const seen = new Set(tools.map((tool) => tool.name));
	return [...tools, ...SYNTHETIC_LOCAL_TOOLS.filter((tool) => !seen.has(tool.name))];
}

function isToolDefinition(value: unknown): value is McpToolDefinition {
	return Boolean(value) && typeof value === "object" && typeof (value as { name?: unknown }).name === "string";
}

export async function readRecentHookLog(maxChars = 4000): Promise<string | undefined> {
	try {
		const logPath = join(process.env.HOME || "", ".mempalace", "hook_state", "hook.log");
		const text = await readFile(logPath, "utf8");
		return text.slice(-maxChars).trim() || undefined;
	} catch {
		return undefined;
	}
}

export function hasStructuredToolFailure(parsed: unknown): boolean {
	if (!parsed || typeof parsed !== "object") return false;
	if ((parsed as { fallback_supported?: unknown }).fallback_supported === false) return true;
	if ((parsed as { success?: unknown }).success === false) return true;
	if (typeof (parsed as { error?: unknown }).error === "string" && (parsed as { partial?: unknown }).partial !== true) return true;
	return false;
}

