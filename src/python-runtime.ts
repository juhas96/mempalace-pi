import { access, readFile, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

export type PythonRuntimeDiscoveryOptions = {
	env?: NodeJS.ProcessEnv;
};

const EXECUTABLES = ["mempalace-mcp", "mempalace"];
const SYSTEM_PYTHON_CANDIDATES = ["python3", "python"];

export async function discoverMemPalacePythonCandidates(
	options: PythonRuntimeDiscoveryOptions = {},
): Promise<string[]> {
	const env = options.env ?? process.env;
	const candidates: string[] = [];

	addCandidate(candidates, env.MEMPALACE_PYTHON?.trim());

	if (env.MEMPALACE_MCP_BIN?.trim()) {
		await addLauncherInterpreter(candidates, env.MEMPALACE_MCP_BIN.trim(), env.PATH);
	}

	for (const executable of EXECUTABLES) {
		const resolved = await resolveOnPath(executable, env.PATH);
		if (resolved) await addLauncherInterpreter(candidates, resolved, env.PATH);
	}

	for (const candidate of SYSTEM_PYTHON_CANDIDATES) addCandidate(candidates, candidate);
	return candidates;
}

async function addLauncherInterpreter(candidates: string[], launcher: string, pathValue?: string): Promise<void> {
	const resolvedLauncher = await resolveLauncherPath(launcher, pathValue);
	if (!resolvedLauncher) return;

	let firstLine: string;
	try {
		firstLine = (await readFile(resolvedLauncher, "utf8")).split(/\r?\n/, 1)[0]?.trim() ?? "";
	} catch {
		return;
	}

	const interpreter = parsePythonShebangInterpreter(firstLine);
	if (!interpreter) return;
	try {
		await access(interpreter);
		addCandidate(candidates, interpreter);
	} catch {
		// Ignore stale or unreadable launchers and continue with other candidates.
	}
}

async function resolveOnPath(executable: string, pathValue: string | undefined): Promise<string | undefined> {
	for (const directory of (pathValue ?? "").split(delimiter)) {
		if (!directory) continue;
		const candidate = join(directory, executable);
		if (await isReadableFile(candidate)) return candidate;
	}
	return undefined;
}

async function resolveLauncherPath(launcher: string, pathValue?: string): Promise<string | undefined> {
	const resolved = isAbsolute(launcher) || launcher.includes("/") || launcher.includes("\\")
		? launcher
		: await resolveOnPath(launcher, pathValue);
	if (!resolved) return undefined;
	try {
		return await realpath(resolved);
	} catch {
		return undefined;
	}
}

async function isReadableFile(candidate: string): Promise<boolean> {
	try {
		await access(candidate);
		return true;
	} catch {
		return false;
	}
}

function parsePythonShebangInterpreter(firstLine: string): string | undefined {
	if (!firstLine.startsWith("#!")) return undefined;
	const parts = firstLine.slice(2).trim().split(/\s+/);
	const command = parts[0] === "/usr/bin/env" ? parts.find((part) => /^python(?:3(?:\.\d+)?)?$/.test(part)) : parts[0];
	return command && isAbsolute(command) && /(?:^|[\\/])python(?:3(?:\.\d+)?)?$/.test(command) ? command : undefined;
}

function addCandidate(candidates: string[], candidate: string | undefined): void {
	if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
}
