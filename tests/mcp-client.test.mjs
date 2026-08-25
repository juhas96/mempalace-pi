import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runScenario(source, env = {}) {
	return execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
		cwd: repoRoot,
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

test("MCP client attempts mempalace-mcp binary before python3 and python", () => {
	const output = runScenario(String.raw`
		import assert from "node:assert/strict";
		import fs from "node:fs/promises";
		import os from "node:os";
		import path from "node:path";
		import { fileURLToPath } from "node:url";

		const root = await fs.mkdtemp(path.join(os.tmpdir(), "mp-mcp-bin-"));
		try {
			// Mock @sinclair/typebox
			await fs.mkdir(path.join(root, "node_modules", "@sinclair", "typebox"), { recursive: true });
			await fs.writeFile(path.join(root, "node_modules", "@sinclair", "typebox", "package.json"), JSON.stringify({ name: "@sinclair/typebox", type: "module", exports: "./index.js" }));
			await fs.writeFile(path.join(root, "node_modules", "@sinclair", "typebox", "index.js"), "export const Type = { Object: () => ({}), Any: () => ({}) };");

			// Copy mcp-client.ts to test root
			const repoRoot = path.resolve(".");
			await fs.copyFile(path.join(repoRoot, "src", "mcp-client.ts"), path.join(root, "mcp-client.ts"));

			// Create mock mempalace-mcp binary in a bin/ folder
			const binDir = path.join(root, "bin");
			await fs.mkdir(binDir, { recursive: true });
			const mockMcpScript = [
				"#!/usr/bin/env node",
				"import readline from 'node:readline';",
				"const rl = readline.createInterface({ input: process.stdin });",
				"rl.on('line', (line) => {",
				"  const msg = JSON.parse(line);",
				"  if (msg.method === 'initialize') {",
				"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'mock-mempalace-mcp', version: '1.0.0' } } }) + '\\n');",
				"  } else if (msg.method === 'notifications/initialized') {",
				"    // ack",
				"  } else if (msg.method === 'tools/list') {",
				"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'mempalace_status', description: 'Mock status' }, { name: 'mempalace_search', description: 'Mock search' }] } }) + '\\n');",
				"  }",
				"});",
			].join("\n");

			const mockBinPath = path.join(binDir, "mempalace-mcp");
			await fs.writeFile(mockBinPath, mockMcpScript, { mode: 0o755 });

			// Prepend binDir to PATH
			const origPath = process.env.PATH;
			process.env.PATH = binDir + path.delimiter + origPath;

			const { MemPalaceMcpClient } = await import(path.join(root, "mcp-client.ts"));
			const client = new MemPalaceMcpClient();
			const result = await client.connect();

			assert.equal(client.isConnected, true);
			assert.equal(result.commandLine, "mempalace-mcp");
			assert.equal(result.tools.length, 2);
			assert.ok(result.tools.some((t) => t.name === "mempalace_status"));
			assert.ok(result.tools.some((t) => t.name === "mempalace_search"));

			await client.close();
			console.log(JSON.stringify({ connected: true, commandLine: result.commandLine, toolCount: result.tools.length }));
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	`);
	assert.match(output, /"connected":true/);
	assert.match(output, /"commandLine":"mempalace-mcp"/);
	assert.match(output, /"toolCount":2/);
});

test("MCP client respects MEMPALACE_MCP_BIN override when set", () => {
	const output = runScenario(String.raw`
		import assert from "node:assert/strict";
		import fs from "node:fs/promises";
		import os from "node:os";
		import path from "node:path";

		const root = await fs.mkdtemp(path.join(os.tmpdir(), "mp-custom-mcp-"));
		try {
			await fs.mkdir(path.join(root, "node_modules", "@sinclair", "typebox"), { recursive: true });
			await fs.writeFile(path.join(root, "node_modules", "@sinclair", "typebox", "package.json"), JSON.stringify({ name: "@sinclair/typebox", type: "module", exports: "./index.js" }));
			await fs.writeFile(path.join(root, "node_modules", "@sinclair", "typebox", "index.js"), "export const Type = { Object: () => ({}), Any: () => ({}) };");

			const repoRoot = path.resolve(".");
			await fs.copyFile(path.join(repoRoot, "src", "mcp-client.ts"), path.join(root, "mcp-client.ts"));

			const mockMcpScript = [
				"#!/usr/bin/env node",
				"import readline from 'node:readline';",
				"const rl = readline.createInterface({ input: process.stdin });",
				"rl.on('line', (line) => {",
				"  const msg = JSON.parse(line);",
				"  if (msg.method === 'initialize') {",
				"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'custom-mcp', version: '1.0.0' } } }) + '\\n');",
				"  } else if (msg.method === 'notifications/initialized') {",
				"    // ack",
				"  } else if (msg.method === 'tools/list') {",
				"    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'custom_tool', description: 'Custom' }] } }) + '\\n');",
				"  }",
				"});",
			].join("\n");

			const customBinPath = path.join(root, "my-custom-mcp");
			await fs.writeFile(customBinPath, mockMcpScript, { mode: 0o755 });

			process.env.MEMPALACE_MCP_BIN = customBinPath;

			const { MemPalaceMcpClient } = await import(path.join(root, "mcp-client.ts"));
			const client = new MemPalaceMcpClient();
			const result = await client.connect();

			assert.equal(client.isConnected, true);
			assert.equal(result.commandLine, customBinPath);
			assert.equal(result.tools.length, 1);
			assert.equal(result.tools[0].name, "custom_tool");

			await client.close();
			console.log(JSON.stringify({ custom: true, commandLine: result.commandLine }));
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	`);
	assert.match(output, /"custom":true/);
	assert.match(output, /my-custom-mcp/);
});

test("MCP client falls back gracefully when mempalace-mcp binary is not on PATH", () => {
	const output = runScenario(String.raw`
		import assert from "node:assert/strict";
		import fs from "node:fs/promises";
		import os from "node:os";
		import path from "node:path";

		const root = await fs.mkdtemp(path.join(os.tmpdir(), "mp-mcp-fallback-"));
		try {
			await fs.mkdir(path.join(root, "node_modules", "@sinclair", "typebox"), { recursive: true });
			await fs.writeFile(path.join(root, "node_modules", "@sinclair", "typebox", "package.json"), JSON.stringify({ name: "@sinclair/typebox", type: "module", exports: "./index.js" }));
			await fs.writeFile(path.join(root, "node_modules", "@sinclair", "typebox", "index.js"), "export const Type = { Object: () => ({}), Any: () => ({}) };");

			const repoRoot = path.resolve(".");
			await fs.copyFile(path.join(repoRoot, "src", "mcp-client.ts"), path.join(root, "mcp-client.ts"));

			const origPath = process.env.PATH;
			process.env.PATH = "/nonexistent-path-12345";
			delete process.env.MEMPALACE_MCP_BIN;

			const { MemPalaceMcpClient } = await import(path.join(root, "mcp-client.ts"));
			const client = new MemPalaceMcpClient();
			let caughtError;
			try {
				await client.connect();
			} catch (err) {
				caughtError = err;
			} finally {
				process.env.PATH = origPath;
			}

			assert.ok(caughtError);
			assert.match(caughtError.message, /MemPalace was not found/i);
			assert.match(caughtError.message, /uv tool install mempalace/i);
			console.log(JSON.stringify({ failedAsExpected: true, message: caughtError.message }));
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	`);
	assert.match(output, /"failedAsExpected":true/);
	assert.match(output, /uv tool install mempalace/);
});

test("getMemPalaceSetupGuidance suggests uv tool install for missing package or binary", () => {
	const output = runScenario(String.raw`
		import assert from "node:assert/strict";
		import fs from "node:fs/promises";
		import path from "node:path";

		const utilsSource = await fs.readFile(path.resolve(".", "src", "utils.ts"), "utf8");

		// Extract getMemPalaceSetupGuidance implementation logic
		assert.match(utilsSource, /uv tool install mempalace/);
		assert.match(utilsSource, /MemPalace could not find a usable mempalace-mcp binary or Python command/);
		assert.match(utilsSource, /mempalace-mcp\|python3\|python/);

		console.log("guidance ok");
	`);
	assert.match(output, /guidance ok/);
});
