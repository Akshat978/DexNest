/** The difference between two settings snapshots, key by key. */

export interface SettingsDiff {
  added: { key: string; value: string }[];
  removed: { key: string; value: string }[];
  changed: { key: string; from: string; to: string }[];
  unchanged: number;
}

export function diffSettings(from: Record<string, string>, to: Record<string, string>): SettingsDiff {
  const diff: SettingsDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
  for (const key of keys) {
    const a = Object.prototype.hasOwnProperty.call(from, key) ? from[key] : undefined;
    const b = Object.prototype.hasOwnProperty.call(to, key) ? to[key] : undefined;
    if (a === undefined && b !== undefined) diff.added.push({ key, value: b });
    else if (a !== undefined && b === undefined) diff.removed.push({ key, value: a });
    else if (a !== undefined && b !== undefined) {
      if (a === b) diff.unchanged += 1;
      else diff.changed.push({ key, from: a, to: b });
    }
  }
  return diff;
}
