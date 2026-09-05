# Codex Usage Monitor (Remaining

A small VS Code extension that shows Codex CLI usage in the status bar by reading local Codex session JSONL files.

This is a fork from yingkaisun-kai/codex-usage-monitor. The change is to show remaining instead of used and other minor presentation updates.

It reads only `token_count` events from:

```text
~/.codex/sessions/YYYY/MM/DD/*.jsonl
```

On Windows, the default path is:

```text
C:\Users\<you>\.codex\sessions
```

## What It Shows

The status bar displays:

```text
Codex 4% / 3%
```

- First number: primary Codex rate-limit window, usually the shorter window.
- Second number: secondary Codex rate-limit window, usually the longer window.

Hover the status item to see:

- plan type
- primary and secondary reset time
- latest request token usage
- latest session total tokens
- scanned file count

## Run In Development

```powershell
cd C:\Users\SunYi\Documents\GitHub\codex-usage-monitor
npm install
npm run compile
code .
```

Then press `F5` in VS Code and choose `Run Extension`. A new Extension Development Host window will open with the status bar item enabled.

## Settings

- `codexUsageMonitor.codexHome`: custom Codex config directory. Empty means `~/.codex`.
- `codexUsageMonitor.refreshIntervalSeconds`: refresh interval. Default: `30`.
- `codexUsageMonitor.scanDays`: only scan session files modified in the last N days. Default: `14`.
- `codexUsageMonitor.warningThresholdPercent`: warning threshold for the primary window. Default: `80`.
- `codexUsageMonitor.criticalThresholdPercent`: critical warning threshold for the primary window. Default: `90`.
- `codexUsageMonitor.showSecondaryWindow`: show the secondary window in the status bar. Default: `true`.

## Commands

- `Codex Usage: Refresh`
- `Codex Usage: Open Sessions Folder`

## Notes

This extension follows the same basic data source used by CC Switch for Codex session usage: local Codex JSONL session logs. It does not call OpenAI APIs, does not proxy requests, and does not read conversation content beyond lines that contain `"token_count"`.
