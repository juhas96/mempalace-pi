import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chooseAutoIngestTarget } from "./auto-ingest-policy.js";
import { AUTO_SAVE_MARKER, DEFAULT_MINE_TIMEOUT_MS } from "./constants";

type SessionEntryLike = {
	id?: string;
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

export type ExecResult = {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
};

export type PythonProbe = {
	python3: ExecResult;
	python: ExecResult;
};

export function stripAtPrefix(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

export function quoteArg(value: string): string {
	return JSON.stringify(value);
}

export function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const maybeText = (part as { type?: string; text?: string }).type === "text" ? (part as { text?: string }).text : "";
			return typeof maybeText === "string" ? maybeText : "";
		})
		.join("\n")
		.trim();
}

export function getRelevantUserMessages(entries: Iterable<SessionEntryLike>) {
	const relevant: Array<{ id?: string; text: string }> = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "user") continue;
		const text = extractText(message.content);
		if (!text) continue;
		if (text.includes(AUTO_SAVE_MARKER)) continue;
		if (text.trim().startsWith("/")) continue;
		relevant.push({ id: entry.id, text });
	}
	return relevant;
}

export function countRelevantUserMessages(ctx: ExtensionContext): number {
	return getRelevantUserMessages(ctx.sessionManager.getBranch()).length;
}

export function getRelevantUserMessageKey(entries: Iterable<SessionEntryLike>): string | undefined {
	const relevant = getRelevantUserMessages(entries);
	if (relevant.length === 0) return undefined;
	const last = relevant[relevant.length - 1];
	const lastId = last?.id?.trim();
	const lastText = last?.text.trim().replace(/\s+/g, " ").slice(0, 160);
	return `${relevant.length}:${lastId || lastText}`;
}

export function truncate(text: string, max = 12000): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n\n… output truncated …`;
}

export function formatExecOutput(label: string, command: string[], result: ExecResult): string {
	const sections: string[] = [`${label}: ${command.join(" ")}`, `exit code: ${result.code}`];
	if (result.stdout.trim()) sections.push(`stdout:\n${truncate(result.stdout.trim())}`);
	if (result.stderr.trim()) sections.push(`stderr:\n${truncate(result.stderr.trim())}`);
	return sections.join("\n\n");
}

export async function runMemPalace(
	pi: ExtensionAPI,
	args: string[],
	signal?: AbortSignal,
): Promise<{ command: string[]; result: ExecResult }> {
	const candidates: Array<[string, string[]]> = [
		["python3", ["-m", "mempalace", ...args]],
		["python", ["-m", "mempalace", ...args]],
		["mempalace", args],
	];

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
		const missingMemPalaceModule = combined.includes("no module named mempalace");

		if (missingMemPalaceModule && !missingModule) {
			missingModule = last;
		}
		if (!missingCommand && !missingMemPalaceModule) return last;
	}

	if (missingModule) return missingModule;
	if (!last) throw new Error("No MemPalace command candidates were attempted.");
	return last;
}

export function toolResult(label: string, command: string[], result: ExecResult) {
	return {
		content: [{ type: "text" as const, text: formatExecOutput(label, command, result) }],
		details: { command, stdout: result.stdout, stderr: result.stderr, exitCode: result.code },
		isError: result.code !== 0,
	};
}

export type AutoIngestOutcome = {
	started: boolean;
	mode: "background" | "foreground";
	targetPath?: string;
	targetSource?: "env" | "session" | "cwd";
	command?: string[];
	result?: ExecResult;
};

function normalizeDirectory(candidate: string | undefined): string | undefined {
	const trimmed = candidate?.trim();
	if (!trimmed) return undefined;
	try {
		const resolved = resolve(trimmed);
		if (!existsSync(resolved)) return undefined;
		const stat = statSync(resolved);
		return stat.isDirectory() ? resolved : dirname(resolved);
	} catch {
		return undefined;
	}
}

export function resolveAutoIngestTarget(ctx?: Pick<ExtensionContext, "cwd" | "sessionManager">): {
	targetPath?: string;
	targetSource?: "env" | "session" | "cwd";
} {
	return chooseAutoIngestTarget({
		envTarget: normalizeDirectory(process.env.MEMPAL_DIR),
		sessionTarget: normalizeDirectory(ctx?.sessionManager.getSessionFile?.()),
		cwdTarget: normalizeDirectory(ctx?.cwd),
	});
}

export async function maybeAutoIngest(
	pi: ExtensionAPI,
	ctx?: Pick<ExtensionContext, "cwd" | "sessionManager">,
	signal?: AbortSignal,
	mode: "background" | "foreground" = "background",
): Promise<AutoIngestOutcome> {
	// Suspend autosave for maintenance (repair/migrate)
	if (process.env.MEMPALACE_SUSPEND_AUTOSAVE === "1") {
		return { started: false, mode };
	}

	const { targetPath, targetSource } = resolveAutoIngestTarget(ctx);
	if (!targetPath || !targetSource) return { started: false, mode };

	// Mine timeout — prevents unbounded runs that block admin operations
	const timeoutMs = parseInt(process.env.MEMPALACE_MINE_TIMEOUT_MS ?? "", 10);
	const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_MINE_TIMEOUT_MS;
	let timedOut = false;
	const controller = new AbortController();
	const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, effectiveTimeout);
	signal?.addEventListener("abort", () => { clearTimeout(timeout); controller.abort(); }, { once: true });
	if (signal?.aborted) { timedOut = true; controller.abort(); }
	const mineSignal = controller.signal;

	if (mode === "background") {
		void runMemPalace(pi, ["mine", targetPath], mineSignal).catch(() => undefined);
		return {
			started: true,
			mode,
			targetPath,
			targetSource,
			command: ["mempalace", "mine", targetPath],
		};
	}

	// Foreground mode — never throw, return structured failure on timeout/error
	try {
		const run = await runMemPalace(pi, ["mine", targetPath], mineSignal);
		clearTimeout(timeout);
		if (timedOut) {
			return { started: true, mode, result: { stdout: "", stderr: "mine timed out", code: -1 }, command: run.command, targetPath, targetSource };
		}
		return {
			started: true,
			mode,
			targetPath,
			targetSource,
			command: run.command,
			result: run.result,
		};
	} catch (err) {
		clearTimeout(timeout);
		if (timedOut) {
			return { started: true, mode, result: { stdout: "", stderr: "mine timed out", code: -1 }, command: [], targetPath, targetSource };
		}
		return { started: true, mode, result: { stdout: "", stderr: String(err), code: -1 }, command: [], targetPath, targetSource };
	}
}

export function sendUserMessage(pi: ExtensionAPI, ctx: ExtensionContext, text: string) {
	if (ctx.isIdle()) {
		pi.sendUserMessage(text);
	} else {
		pi.sendUserMessage(text, { deliverAs: "followUp" });
	}
}

export function getMemPalaceSetupGuidance(error: string | undefined): string | undefined {
	if (!error) return undefined;
	if (/No module named mempalace/i.test(error) || /mempalace package is not installed/i.test(error)) {
		return "MemPalace is disabled because the Python package 'mempalace' is not available to the active runtime. Install with uv tool install mempalace, pipx install mempalace, pipx install --global mempalace, or python3 -m pip install mempalace. For isolated installs, ensure the launcher directory is on PATH or set MEMPALACE_PYTHON.";
	}
	if (/Python was not found/i.test(error) || /MemPalace was not found/i.test(error) || /spawn (?:mempalace-mcp|python3|python) ENOENT/i.test(error)) {
		return "MemPalace could not find a usable mempalace-mcp binary or Python command in Pi's runtime environment. If mempalace works in your terminal but not in Pi, the PATH may differ. Run /mempalace:doctor to check what Pi can see.";
	}
	return undefined;
}

export async function probePythonEnvironment(pi: ExtensionAPI, signal?: AbortSignal): Promise<PythonProbe> {
	const python3 = (await pi.exec("python3", ["--version"], { signal })) as ExecResult;
	const python = (await pi.exec("python", ["--version"], { signal })) as ExecResult;
	return { python3, python };
}

export function summarizePythonProbe(probe: PythonProbe): string[] {
	const format = (label: string, result: ExecResult) => {
		const output = (result.stdout || result.stderr).trim() || "no output";
		return `${label}: exit ${result.code} (${truncate(output, 160)})`;
	};
	return [format("python3 --version", probe.python3), format("python --version", probe.python)];
}

export function refineSetupGuidance(guidance: string | undefined, probe?: PythonProbe): string | undefined {
	if (!guidance) return undefined;
	if (!probe) return guidance;

	const python3Ok = probe.python3.code === 0;
	const pythonOk = probe.python.code === 0;
	if (/usable Python command/i.test(guidance)) {
		if (python3Ok || pythonOk) {
			const visible = [python3Ok ? (probe.python3.stdout || probe.python3.stderr).trim() : "", pythonOk ? (probe.python.stdout || probe.python.stderr).trim() : ""]
				.filter(Boolean)
				.join(", ");
			return `MemPalace could not start its backend, but Pi can see Python (${visible || "version detected"}). The package may be installed in a different isolated runtime. Ensure mempalace-mcp/mempalace is on PATH, or set MEMPALACE_PYTHON to its interpreter. Install with uv tool install mempalace, pipx install mempalace, pipx install --global mempalace, or python3 -m pip install mempalace. If that still fails, run /mempalace:doctor to compare what Pi can see.`;
		}
	}
	return guidance;
}

export function getMemPalaceSetupGuidanceFromExec(command: string[], result: ExecResult): string | undefined {
	const combined = [command.join(" "), result.stdout, result.stderr].filter(Boolean).join("\n");
	return getMemPalaceSetupGuidance(combined);
}

export function unavailableToolResult(
	label: string,
	guidance: string,
	command?: string[],
	result?: ExecResult,
	transport?: "cli" | "mcp" | "python",
) {
	const details: Record<string, unknown> = {
		unavailable: true,
		guidance,
		transport: transport || "cli",
	};
	if (command) details.command = command;
	if (result) {
		details.stdout = result.stdout;
		details.stderr = result.stderr;
		details.exitCode = result.code;
	}
	return {
		content: [{ type: "text" as const, text: `${label} unavailable. ${guidance}` }],
		details,
		isError: true,
	};
}
