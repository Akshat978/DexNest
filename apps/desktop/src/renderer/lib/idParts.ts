/**
 * An action id ("heatmap.log_current_app") in the pieces it may break
 * between: after each "." and "_". Rendered with <wbr> between them, a narrow
 * column wraps an id at a word boundary instead of mid-word.
 */
export function idParts(id: string): string[] {
  return id.split(/(?<=[._])/).filter(Boolean);
}
