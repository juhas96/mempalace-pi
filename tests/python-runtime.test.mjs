import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("discovers isolated uv and pipx Python interpreters from launchers and overrides", () => {
	const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", String.raw`
		import assert from "node:assert/strict";
		import fs from "node:fs/promises";
		import os from "node:os";
		import path from "node:path";
		import { pathToFileURL } from "node:url";
		import { discoverMemPalacePythonCandidates } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "src", "python-runtime.ts")).href)};

		const root = await fs.mkdtemp(path.join(os.tmpdir(), "mempalace-runtime-"));
		try {
			const uvPython = path.join(root, "uv", "tools", "mempalace", "bin", "python");
			const pipxPython = path.join(root, "pipx", "venvs", "mempalace", "bin", "python");
			const globalPython = path.join(root, "system", "pipx", "venvs", "mempalace", "bin", "python");
			const overridePython = path.join(root, "overrides", "mempalace-python");
			const customMcp = path.join(root, "custom", "mempalace-mcp");
			const uvMcp = path.join(root, "uv", "bin", "mempalace-mcp");
			const globalMempalace = path.join(root, "system", "bin", "mempalace");
			const binDir = path.join(root, "bin");
			await fs.mkdir(path.dirname(uvPython), { recursive: true });
			await fs.mkdir(path.dirname(pipxPython), { recursive: true });
			await fs.mkdir(path.dirname(globalPython), { recursive: true });
			await fs.mkdir(path.dirname(overridePython), { recursive: true });
			await fs.mkdir(path.dirname(customMcp), { recursive: true });
			await fs.mkdir(path.dirname(uvMcp), { recursive: true });
			await fs.mkdir(path.dirname(globalMempalace), { recursive: true });
			await fs.mkdir(binDir, { recursive: true });

			for (const python of [uvPython, pipxPython, globalPython, overridePython]) {
				await fs.writeFile(python, "", { mode: 0o755 });
			}
			await fs.writeFile(customMcp, "#!" + pipxPython + "\n", { mode: 0o755 });
			await fs.writeFile(uvMcp, "#!" + uvPython + "\n", { mode: 0o755 });
			await fs.writeFile(globalMempalace, "#!" + globalPython + "\n", { mode: 0o755 });
			const linkedMcp = path.join(binDir, "mempalace-mcp");
			await fs.symlink(uvMcp, linkedMcp);

			const candidates = await discoverMemPalacePythonCandidates({
				env: {
					PATH: binDir + path.delimiter + path.dirname(globalMempalace),
					MEMPALACE_MCP_BIN: customMcp,
					MEMPALACE_PYTHON: overridePython,
				},
			});

			assert.deepEqual(candidates.slice(0, 4), [overridePython, pipxPython, uvPython, globalPython]);
			assert.equal(candidates.filter((candidate) => candidate === uvPython).length, 1);
			assert.deepEqual(candidates.slice(-2), ["python3", "python"]);
			console.log(JSON.stringify({ candidates }));
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	`], {
		cwd: repoRoot,
		encoding: "utf8",
		env: process.env,
	});

	assert.match(output, /"candidates"/);
	assert.match(output, /pipx[\\/]venvs[\\/]mempalace[\\/]bin[\\/]python/);
	assert.match(output, /uv[\\/]tools[\\/]mempalace[\\/]bin[\\/]python/);
});

test("skips malformed launcher shebangs and retains system Python candidates", () => {
	const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", String.raw`
		import assert from "node:assert/strict";
		import fs from "node:fs/promises";
		import os from "node:os";
		import path from "node:path";
		import { pathToFileURL } from "node:url";
		import { discoverMemPalacePythonCandidates } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "src", "python-runtime.ts")).href)};

		const root = await fs.mkdtemp(path.join(os.tmpdir(), "mempalace-runtime-invalid-"));
		try {
			const binDir = path.join(root, "bin");
			const validPython = path.join(root, "venv", "bin", "python3.12");
			await fs.mkdir(path.dirname(validPython), { recursive: true });
			await fs.mkdir(binDir, { recursive: true });
			await fs.writeFile(validPython, "", { mode: 0o755 });
			await fs.writeFile(path.join(binDir, "mempalace-mcp"), "#!/bin/sh\n", { mode: 0o755 });
			await fs.writeFile(path.join(binDir, "mempalace"), "#!" + validPython + "\n", { mode: 0o755 });

			const candidates = await discoverMemPalacePythonCandidates({ env: { PATH: binDir } });
			assert.equal(candidates[0], validPython);
			assert.deepEqual(candidates.slice(-2), ["python3", "python"]);
			assert.equal(candidates.includes("/bin/sh"), false);
			console.log(JSON.stringify({ candidates }));
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	`], {
		cwd: repoRoot,
		encoding: "utf8",
		env: process.env,
	});

	assert.match(output, /"candidates"/);
});
