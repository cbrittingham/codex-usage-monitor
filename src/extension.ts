import * as path from "path";
import * as vscode from "vscode";
import { CodexUsageSnapshot, readCodexUsage } from "./codexUsage";

let statusBar: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let refreshTimer: NodeJS.Timeout | undefined;
let lastWarningKey: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Codex Usage Monitor");
  outputChannel.appendLine("Activating Codex Usage Monitor...");

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    10,
  );
  statusBar.command = "codexUsageMonitor.refresh";
  statusBar.name = "Codex Usage Monitor";
  statusBar.text = "Codex ...";
  statusBar.tooltip = "Loading Codex usage...";
  statusBar.show();

  context.subscriptions.push(statusBar, outputChannel);
  context.subscriptions.push(
    vscode.commands.registerCommand("codexUsageMonitor.refresh", () =>
      refreshUsage(true),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexUsageMonitor.openSessionsFolder",
      openSessionsFolder,
    ),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexUsageMonitor")) {
        scheduleRefresh();
        void refreshUsage(false);
      }
    }),
  );

  scheduleRefresh();
  void refreshUsage(false);
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  const intervalSeconds = getConfig().get<number>("refreshIntervalSeconds", 30);
  refreshTimer = setInterval(
    () => refreshUsage(false),
    Math.max(5, intervalSeconds) * 1000,
  );
}

async function refreshUsage(showInfo: boolean): Promise<void> {
  const config = getConfig();
  statusBar.text = "Codex ...";
  outputChannel.appendLine("Refreshing Codex usage...");

  try {
    const snapshot = await readCodexUsage({
      codexHome: config.get<string>("codexHome", ""),
      scanDays: config.get<number>("scanDays", 14),
    });

    renderSnapshot(snapshot);
    outputChannel.appendLine(
      `Usage loaded: primary= secondary= files= events=`,
    );
    maybeWarn(snapshot);

    if (showInfo) {
      vscode.window.showInformationMessage("Codex usage refreshed.");
    }
  } catch (error) {
    statusBar.text = "Codex ?";
    statusBar.tooltip = `Failed to read Codex usage: ${String(error)}`;
    if (showInfo) {
      vscode.window.showErrorMessage(
        `Failed to read Codex usage: ${String(error)}`,
      );
    }
  }
}

function renderSnapshot(snapshot: CodexUsageSnapshot): void {
  const showSecondary = getConfig().get<boolean>("showSecondaryWindow", true);

  if (!snapshot.primary && !snapshot.secondary) {
    statusBar.text = "Codex no data";
    statusBar.tooltip = buildTooltip(snapshot);
    return;
  }

  let primaryLabel = snapshot.primary?.windowMinutes
    ? `${formatWindowMinutes(snapshot.primary.windowMinutes)}`
    : "";
  let secondaryLabel = snapshot.secondary?.windowMinutes
    ? `${formatWindowMinutes(snapshot.secondary.windowMinutes)}`
    : "";

  const primary = snapshot.primary
    ? `${formatPercent(snapshot.primary.usedPercent)}`
    : "--";
  const secondary = snapshot.secondary
    ? `${formatPercent(snapshot.secondary.usedPercent)}`
    : "--";
  statusBar.text = showSecondary
    ? `Codex ${primary} (${primaryLabel}) / ${secondary} (${secondaryLabel})`
    : `Codex ${primary}`;
  statusBar.tooltip = buildTooltip(snapshot);
}

function buildTooltip(snapshot: CodexUsageSnapshot): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.isTrusted = true;
  tooltip.appendMarkdown("**Codex Usage Monitor (Remaining)**\n\n");

  if (snapshot.planType) {
    tooltip.appendMarkdown(`Plan: \`${snapshot.planType}\`\n\n`);
  }

  let primaryLabel = snapshot.primary?.windowMinutes
    ? `${formatWindowMinutes(snapshot.primary.windowMinutes)}`
    : "Primary";
  let secondaryLabel = snapshot.secondary?.windowMinutes
    ? `${formatWindowMinutes(snapshot.secondary.windowMinutes)}`
    : "Secondary";

  tooltip.appendMarkdown(
    `${primaryLabel}: ${formatWindow(snapshot.primary)}\n\n`,
  );
  tooltip.appendMarkdown(
    `${secondaryLabel}: ${formatWindow(snapshot.secondary)}\n\n`,
  );

  if (snapshot.lastTokenUsage) {
    tooltip.appendMarkdown(
      `Last request tokens: ${snapshot.lastTokenUsage.totalTokens.toLocaleString()} `,
    );
    tooltip.appendMarkdown(
      `(in ${snapshot.lastTokenUsage.inputTokens.toLocaleString()}, out ${snapshot.lastTokenUsage.outputTokens.toLocaleString()}, cached ${snapshot.lastTokenUsage.cachedInputTokens.toLocaleString()})\n\n`,
    );
  }

  if (snapshot.totalTokenUsage) {
    tooltip.appendMarkdown(
      `Session total tokens: ${snapshot.totalTokenUsage.totalTokens.toLocaleString()}\n\n`,
    );
  }

  if (snapshot.latestTimestamp) {
    tooltip.appendMarkdown(
      `Latest event: ${formatDateTime(snapshot.latestTimestamp)}\n\n`,
    );
  }

  tooltip.appendMarkdown(
    `Scanned files: ${snapshot.filesScanned}, token events: ${snapshot.tokenEventsSeen}\n\n`,
  );
  tooltip.appendMarkdown(
    `[Open sessions folder](command:codexUsageMonitor.openSessionsFolder)`,
  );
  return tooltip;
}

function formatWindow(window: CodexUsageSnapshot["primary"]): string {
  if (!window) {
    return "no data";
  }

  const reset = window.resetsAt
    ? `, resets ${formatEpochSeconds(window.resetsAt)}`
    : "";
  return `${formatPercent(window.usedPercent)}${reset}`;
}

function maybeWarn(snapshot: CodexUsageSnapshot): void {
  const primary = snapshot.primary;
  if (!primary) {
    return;
  }

  const config = getConfig();
  const critical = config.get<number>("criticalThresholdPercent", 90);
  const warning = config.get<number>("warningThresholdPercent", 80);
  const level =
    primary.usedPercent >= critical
      ? "critical"
      : primary.usedPercent >= warning
        ? "warning"
        : undefined;
  if (!level) {
    return;
  }

  const resetKey = primary.resetsAt ?? 0;
  const key = `${level}:${resetKey}`;
  if (key === lastWarningKey) {
    return;
  }

  lastWarningKey = key;
  const message =
    level === "critical"
      ? `Codex primary window is at ${formatPercent(primary.usedPercent)}.`
      : `Codex primary window reached ${formatPercent(primary.usedPercent)}.`;
  vscode.window.showWarningMessage(message);
}

async function openSessionsFolder(): Promise<void> {
  const config = getConfig();
  const snapshot = await readCodexUsage({
    codexHome: config.get<string>("codexHome", ""),
    scanDays: 1,
  });
  await vscode.env.openExternal(vscode.Uri.file(snapshot.sessionsDir));
}

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("codexUsageMonitor");
}

function formatPercent(value: number, invert = true): string {
  const percent = invert ? 100 - value : value;
  return `${Math.round(percent)}%`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatEpochSeconds(value: number): string {
  return new Date(value * 1000).toLocaleString();
}

function formatWindowMinutes(value: number): string {
  if (value % (24 * 60) === 0) {
    return `${value / (24 * 60)}d`;
  }
  if (value % 60 === 0) {
    return `${value / 60}h`;
  }
  return `${value}m`;
}
