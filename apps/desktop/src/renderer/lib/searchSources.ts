// Where a Search result opens. A result's source is the id of the screen it
// belongs to, except for the few that are not a screen of their own.

const NOT_A_SCREEN: Record<string, string> = {
  tools_ocr: "tools",
  reminders: "today"
};

export function viewForSearchSource(sourceModule: string): string {
  return NOT_A_SCREEN[sourceModule] ?? sourceModule;
}
