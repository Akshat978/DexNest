import { formatLocalDateTime } from "@dexnest/shared-types";

// Generic display formatters shared across DexNest module views.

export function previewForUi(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value: string): string {
  return formatLocalDateTime(value);
}

export function shortcutLabel(value: string): string {
  return value
    .replaceAll("CommandOrControl", "Ctrl")
    .replaceAll("+", " + ");
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) {
    return `${minutes}m`;
  }
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
