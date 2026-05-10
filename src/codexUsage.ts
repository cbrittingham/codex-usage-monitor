import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface RateLimitWindow {
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
}

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexUsageSnapshot {
  codexHome: string;
  sessionsDir: string;
  latestTimestamp?: string;
  latestFile?: string;
  planType?: string;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
  totalTokenUsage?: TokenUsage;
  lastTokenUsage?: TokenUsage;
  modelContextWindow?: number;
  filesScanned: number;
  tokenEventsSeen: number;
}

export interface ReadUsageOptions {
  codexHome?: string;
  scanDays: number;
}

interface TokenCountLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    info?: {
      total_token_usage?: RawTokenUsage;
      last_token_usage?: RawTokenUsage;
      model_context_window?: number;
    } | null;
    rate_limits?: {
      primary?: RawRateLimitWindow;
      secondary?: RawRateLimitWindow;
      plan_type?: string;
    };
  };
}

interface RawRateLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

interface RawTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export async function readCodexUsage(options: ReadUsageOptions): Promise<CodexUsageSnapshot> {
  const codexHome = expandHome(options.codexHome?.trim() || path.join(os.homedir(), '.codex'));
  const sessionsDir = path.join(codexHome, 'sessions');
  const cutoffMs = Date.now() - Math.max(1, options.scanDays) * 24 * 60 * 60 * 1000;
  const files = await collectJsonlFiles(sessionsDir, cutoffMs);

  let latest: CodexUsageSnapshot = {
    codexHome,
    sessionsDir,
    filesScanned: files.length,
    tokenEventsSeen: 0,
  };
  let latestMs = -Infinity;

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8').catch(() => undefined);
    if (!text) {
      continue;
    }

    for (const line of text.split(/\r?\n/)) {
      if (!line.includes('"token_count"')) {
        continue;
      }

      const parsed = parseTokenCountLine(line);
      if (!parsed) {
        continue;
      }

      latest.tokenEventsSeen += 1;
      const timestampMs = parsed.timestamp ? Date.parse(parsed.timestamp) : 0;
      if (Number.isNaN(timestampMs) || timestampMs < latestMs) {
        continue;
      }

      latestMs = timestampMs;
      latest = {
        ...latest,
        latestTimestamp: parsed.timestamp,
        latestFile: file,
        planType: parsed.payload?.rate_limits?.plan_type,
        primary: normalizeWindow(parsed.payload?.rate_limits?.primary),
        secondary: normalizeWindow(parsed.payload?.rate_limits?.secondary),
        totalTokenUsage: normalizeTokenUsage(parsed.payload?.info?.total_token_usage),
        lastTokenUsage: normalizeTokenUsage(parsed.payload?.info?.last_token_usage),
        modelContextWindow: parsed.payload?.info?.model_context_window,
      };
    }
  }

  return latest;
}

async function collectJsonlFiles(root: string, cutoffMs: number): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) {
      return;
    }

    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      const stat = await fs.stat(fullPath).catch(() => undefined);
      if (!stat || stat.mtimeMs < cutoffMs) {
        continue;
      }
      files.push(fullPath);
    }
  }

  await walk(root, 0);
  files.sort();
  return files;
}

function parseTokenCountLine(line: string): TokenCountLine | undefined {
  try {
    const value = JSON.parse(line) as TokenCountLine;
    if (value.type !== 'event_msg' || value.payload?.type !== 'token_count') {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function normalizeWindow(raw?: RawRateLimitWindow): RateLimitWindow | undefined {
  if (!raw || typeof raw.used_percent !== 'number') {
    return undefined;
  }
  return {
    usedPercent: raw.used_percent,
    windowMinutes: raw.window_minutes,
    resetsAt: raw.resets_at,
  };
}

function normalizeTokenUsage(raw?: RawTokenUsage): TokenUsage | undefined {
  if (!raw) {
    return undefined;
  }

  const inputTokens = raw.input_tokens ?? 0;
  const cachedInputTokens = raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? 0;
  const outputTokens = raw.output_tokens ?? 0;
  const reasoningOutputTokens = raw.reasoning_output_tokens ?? 0;
  const totalTokens = raw.total_tokens ?? inputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}
