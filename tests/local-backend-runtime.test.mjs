import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callLocalMemPalaceTool } from "../src/local-backend.ts";

test("local fallback runs MCP-only tools with the isolated MemPalace interpreter", async () => {
	const root = await mkdtemp(join(tmpdir(), "mempalace-local-runtime-"));
	const originalMcpBin = process.env.MEMPALACE_MCP_BIN;
	const originalPython = process.env.MEMPALACE_PYTHON;
	try {
		const python = join(root, "pipx", "venvs", "mempalace", "bin", "python");
		const launcher = join(root, "pipx", "bin", "mempalace-mcp");
		await mkdir(join(root, "pipx", "venvs", "mempalace", "bin"), { recursive: true });
		await mkdir(join(root, "pipx", "bin"), { recursive: true });
		await writeFile(python, "", { mode: 0o755 });
		await writeFile(launcher, "#!" + python + "\n", { mode: 0o755 });
		process.env.MEMPALACE_MCP_BIN = launcher;
		delete process.env.MEMPALACE_PYTHON;

		const calls = [];
		const pi = {
			exec: async (command, args) => {
				calls.push({ command, args });
				return { stdout: JSON.stringify({ success: true }), stderr: "", code: 0 };
			},
		};

		const result = await callLocalMemPalaceTool(pi, "mempalace_checkpoint", { summary: "test" });
		assert.equal(result.result.code, 0);
		assert.equal(calls[0].command, python);
		assert.equal(calls[0].args[0], "-c");
	} finally {
		if (originalMcpBin === undefined) delete process.env.MEMPALACE_MCP_BIN;
		else process.env.MEMPALACE_MCP_BIN = originalMcpBin;
		if (originalPython === undefined) delete process.env.MEMPALACE_PYTHON;
		else process.env.MEMPALACE_PYTHON = originalPython;
		await rm(root, { recursive: true, force: true });
	}
});

test("MEMPALACE_PYTHON overrides launcher-derived interpreters", async () => {
	const originalMcpBin = process.env.MEMPALACE_MCP_BIN;
	const originalPython = process.env.MEMPALACE_PYTHON;
	try {
		process.env.MEMPALACE_MCP_BIN = "/not-used/mempalace-mcp";
		process.env.MEMPALACE_PYTHON = "/custom/mempalace/python";
		const calls = [];
		const pi = {
			exec: async (command, args) => {
				calls.push({ command, args });
				return { stdout: JSON.stringify({ success: true }), stderr: "", code: 0 };
			},
		};

		await callLocalMemPalaceTool(pi, "mempalace_checkpoint", { summary: "override" });
		assert.equal(calls[0].command, "/custom/mempalace/python");
	} finally {
		if (originalMcpBin === undefined) delete process.env.MEMPALACE_MCP_BIN;
		else process.env.MEMPALACE_MCP_BIN = originalMcpBin;
		if (originalPython === undefined) delete process.env.MEMPALACE_PYTHON;
		else process.env.MEMPALACE_PYTHON = originalPython;
	}
});

test("local fallback reports every attempted Python interpreter", async () => {
	const root = await mkdtemp(join(tmpdir(), "mempalace-local-diagnostics-"));
	const originalMcpBin = process.env.MEMPALACE_MCP_BIN;
	const originalPython = process.env.MEMPALACE_PYTHON;
	const originalPath = process.env.PATH;
	try {
		const isolatedPython = join(root, "pipx", "venvs", "mempalace", "bin", "python");
		const launcher = join(root, "bin", "mempalace-mcp");
		await mkdir(join(root, "pipx", "venvs", "mempalace", "bin"), { recursive: true });
		await mkdir(join(root, "bin"), { recursive: true });
		await writeFile(isolatedPython, "", { mode: 0o755 });
		await writeFile(launcher, "#!" + isolatedPython + "\n", { mode: 0o755 });
		process.env.MEMPALACE_MCP_BIN = launcher;
		process.env.MEMPALACE_PYTHON = "/custom/mempalace/python";
		process.env.PATH = join(root, "bin");

		const calls = [];
		const pi = {
			exec: async (command) => {
				calls.push(command);
				return { stdout: "", stderr: "ModuleNotFoundError: No module named 'mempalace'", code: 1 };
			},
		};

		const result = await callLocalMemPalaceTool(pi, "mempalace_checkpoint", { summary: "diagnostics" });
		assert.deepEqual(calls, ["/custom/mempalace/python", isolatedPython, "python3", "python"]);
		assert.match(result.result.stderr, /Attempted MemPalace Python interpreters:/);
		for (const candidate of calls) assert.match(result.result.stderr, new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	} finally {
		if (originalMcpBin === undefined) delete process.env.MEMPALACE_MCP_BIN;
		else process.env.MEMPALACE_MCP_BIN = originalMcpBin;
		if (originalPython === undefined) delete process.env.MEMPALACE_PYTHON;
		else process.env.MEMPALACE_PYTHON = originalPython;
		if (originalPath === undefined) delete process.env.PATH;
		else process.env.PATH = originalPath;
		await rm(root, { recursive: true, force: true });
	}
});
