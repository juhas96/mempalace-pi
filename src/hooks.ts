import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { AUTO_SAVE_MARKER, PRECOMPACT_BLOCK_REASON, SAVE_INTERVAL, STOP_BLOCK_REASON } from "./constants";
import type { MemPalaceRuntime } from "./runtime";
import { canForegroundIngestSatisfyPrecompact } from "./auto-ingest-policy.js";
import { shouldShowHookToast, shouldUseSilentSave } from "./hook-settings-policy.js";
import {
	countRelevantUserMessages,
	getMemPalaceSetupGuidance,
	getRelevantUserMessageKey,
	maybeAutoIngest,
	probePythonEnvironment,
	refineSetupGuidance,
	sendUserMessage,
} from "./utils";

export function registerHooks(pi: ExtensionAPI, runtime: MemPalaceRuntime) {
	pi.on("session_start", async (_event, ctx) => {
		runtime.loadState(ctx);
		const { tools: localTools } = await runtime.ensureLocalFallbackTools();
		const { tools } = await runtime.ensureMcpConnected();
		await runtime.refreshHookSettings();
		runtime.registerDiscoveredMcpTools();
		runtime.registerDiscoveredFallbackTools();
		if (ctx.hasUI && tools.length > 0) {
			ctx.ui.notify(`MemPalace MCP connected (${tools.length} tools)`, "success");
			return;
		}
		if (ctx.hasUI && localTools.length > 0) {
			ctx.ui.notify(`MemPalace local fallback ready (${localTools.length} tools)`, "info");
			return;
		}

		const probe = await probePythonEnvironment(pi).catch(() => undefined);
		const guidance = refineSetupGuidance(getMemPalaceSetupGuidance(runtime.mcpStartupError), probe);
		if (!guidance || runtime.hasShownSetupNotice) return;
		runtime.hasShownSetupNotice = true;
		if (ctx.hasUI) {
			ctx.ui.notify(guidance, "warning");
		}
		pi.sendMessage({
			customType: "mempalace-notice",
			content: guidance,
			display: true,
			details: { severity: "warning", source: "session_start", error: runtime.mcpStartupError },
		});
	});

	pi.on("session_tree", async (_event, ctx) => {
		runtime.loadState(ctx);
	});

	pi.on("session_shutdown", async () => {
		await runtime.shutdown();
	});

	pi.on("agent_end", async (_event, ctx) => {
		const currentCount = countRelevantUserMessages(ctx);
		if (currentCount <= 0) return;
		if (currentCount - runtime.lastAutoSaveCount < SAVE_INTERVAL) return;

		const hookSettings = await runtime.refreshHookSettings();
		const ingest = await maybeAutoIngest(pi, ctx, undefined, "background");
		if (ingest.started) {
			runtime.lastAutoSaveCount = currentCount;
		}
		runtime.recordAutoIngest(ingest);
		runtime.persistState();
		if (shouldUseSilentSave(hookSettings)) {
			const filedAway = await runtime.acknowledgeMemoriesFiledAway();
			if (ctx.hasUI && shouldShowHookToast(hookSettings)) {
				ctx.ui.notify(
					filedAway?.status === "ok"
						? filedAway.message || `MemPalace auto-save checkpoint filed (${currentCount} messages)`
						: `MemPalace auto-save checkpoint queued silently (${currentCount} messages)`,
					filedAway?.status === "ok" ? "success" : "info",
				);
			}
			runtime.persistState();
			return;
		}
		if (ctx.hasUI && shouldShowHookToast(hookSettings)) {
			ctx.ui.notify(`MemPalace auto-save checkpoint triggered (${currentCount} messages)`, "info");
		}
		sendUserMessage(pi, ctx, `${AUTO_SAVE_MARKER}\n${STOP_BLOCK_REASON}`);
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const warningKey = getRelevantUserMessageKey(event.branchEntries);
		if (!warningKey) {
			return;
		}
		if (runtime.lastPreCompactWarningKey === warningKey) {
			return;
		}

		const hookSettings = await runtime.refreshHookSettings(event.signal);
		const ingest = await maybeAutoIngest(pi, ctx, event.signal, "foreground");
		runtime.recordAutoIngest(ingest);
		if (canForegroundIngestSatisfyPrecompact(ingest)) {
			const reconnect = await runtime.reconnectPalace(event.signal);
			const filedAway = await runtime.acknowledgeMemoriesFiledAway(event.signal);
			runtime.persistState();
			if (ctx.hasUI && shouldShowHookToast(hookSettings)) {
				const suffix = reconnect?.success ? " and reconnected" : "";
				const message = filedAway?.status === "ok" ? `${filedAway.message || "Memories filed away"}${suffix}` : `MemPalace pre-compact ingest completed${suffix}`;
				ctx.ui.notify(message, "success");
			}
			return;
		}

		runtime.lastPreCompactWarningKey = warningKey;
		runtime.persistState();
		if (ctx.hasUI && shouldShowHookToast(hookSettings)) {
			ctx.ui.notify("MemPalace pre-compact save checkpoint triggered", "warning");
		}
		sendUserMessage(pi, ctx, `${AUTO_SAVE_MARKER}\n${PRECOMPACT_BLOCK_REASON}`);
		return { cancel: true };
	});
}
