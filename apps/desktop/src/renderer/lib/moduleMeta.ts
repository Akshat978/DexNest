import {
  Activity, Calculator, CalendarClock, CalendarDays, ClipboardList, CloudSun, Code2, Command,
  Bot, HardDriveDownload, Inbox, LayoutGrid, Lightbulb, Newspaper, NotebookPen, PackageSearch,
  ScrollText, Settings as SettingsIcon, Share2, Sparkles, Stethoscope, Vault, Wallet, Wrench,
  type LucideIcon
} from "lucide-react";

/** Every view the shell can route to. */
export type ViewId =
  | "command" | "dev" | "autopilot" | "deck" | "clipboard" | "drop" | "tools" | "vault"
  | "search" | "capture" | "journal" | "calendar" | "timetable" | "utilities" | "news"
  | "finder" | "finance" | "heatmap" | "devices" | "backup" | "health" | "audit" | "settings";

export interface SidebarView {
  id: ViewId;
  label: string;
  accentClass: string;
  actionId: string;
}

/**
 * The sidebar registry, in display order.
 *
 * Order is product surface, not bookkeeping: the shell renders this list top to
 * bottom in a scrolling rail, so anything appended to the end is effectively
 * hidden below the fold on a normal window. Autopilot sits with Dev because it
 * is developer/system tooling and because that keeps it visible without
 * scrolling.
 */
export const SIDEBAR_VIEWS: SidebarView[] = [
  { id: "command", label: "Command", accentClass: "accent-command", actionId: "command.open_home" },
  { id: "search", label: "Search / Ask", accentClass: "accent-search", actionId: "search.open" },
  { id: "clipboard", label: "Clipboard", accentClass: "accent-clipboard", actionId: "clipboard.open" },
  { id: "drop", label: "Drop", accentClass: "accent-drop", actionId: "drop.open" },
  { id: "tools", label: "Tools", accentClass: "accent-tools", actionId: "tools.open" },
  { id: "vault", label: "Vault", accentClass: "accent-vault", actionId: "vault.open" },
  { id: "journal", label: "Journal", accentClass: "accent-journal", actionId: "journal.open_today" },
  { id: "calendar", label: "Calendar", accentClass: "accent-calendar", actionId: "calendar.show_today" },
  { id: "timetable", label: "Timetable", accentClass: "accent-timetable", actionId: "timetable.open" },
  { id: "utilities", label: "Utilities", accentClass: "accent-utilities", actionId: "utilities.open" },
  { id: "news", label: "News", accentClass: "accent-news", actionId: "news.open" },
  { id: "finder", label: "Finder", accentClass: "accent-finder", actionId: "finder.open" },
  { id: "capture", label: "Capture", accentClass: "accent-capture", actionId: "capture.open" },
  { id: "finance", label: "Finance", accentClass: "accent-finance", actionId: "finance.open" },
  { id: "dev", label: "Dev", accentClass: "accent-dev", actionId: "dev.open_dashboard" },
  { id: "autopilot", label: "Autopilot", accentClass: "accent-dev", actionId: "autopilot.open" },
  { id: "deck", label: "Deck", accentClass: "accent-deck", actionId: "deck.test_endpoint" },
  { id: "heatmap", label: "Heatmap", accentClass: "accent-heatmap", actionId: "heatmap.open" },
  { id: "devices", label: "External Devices", accentClass: "accent-tools", actionId: "" },
  { id: "backup", label: "Backup", accentClass: "accent-command", actionId: "" },
  { id: "health", label: "App Health", accentClass: "accent-command", actionId: "" },
  { id: "settings", label: "Settings", accentClass: "accent-command", actionId: "settings.open" },
  { id: "audit", label: "Audit", accentClass: "accent-command", actionId: "audit.open_history" }
];

/** Views the sidebar deliberately does not show. Audit is reached from Command. */
export const SIDEBAR_HIDDEN_VIEWS: ViewId[] = ["audit"];

// Icon + accent for each module, shared across the shell and module views.
export const MODULE_META: Record<string, { icon: LucideIcon; accent: string }> = {
  command: { icon: Command, accent: "#22D3EE" },
  dev: { icon: Code2, accent: "#3B82F6" },
  autopilot: { icon: Bot, accent: "#0EA5E9" },
  deck: { icon: LayoutGrid, accent: "#A855F7" },
  clipboard: { icon: ClipboardList, accent: "#8B5CF6" },
  drop: { icon: Share2, accent: "#38BDF8" },
  tools: { icon: Wrench, accent: "#F97316" },
  vault: { icon: Vault, accent: "#10B981" },
  search: { icon: Sparkles, accent: "#6366F1" },
  capture: { icon: Inbox, accent: "#EC4899" },
  journal: { icon: NotebookPen, accent: "#F59E0B" },
  calendar: { icon: CalendarDays, accent: "#14B8A6" },
  timetable: { icon: CalendarClock, accent: "var(--accent-timetable)" },
  utilities: { icon: Calculator, accent: "var(--accent-utilities)" },
  weather: { icon: CloudSun, accent: "var(--accent-weather)" },
  news: { icon: Newspaper, accent: "var(--accent-news)" },
  finder: { icon: PackageSearch, accent: "#84CC16" },
  finance: { icon: Wallet, accent: "#22C55E" },
  heatmap: { icon: Activity, accent: "#EF4444" },
  devices: { icon: Lightbulb, accent: "#FB923C" },
  backup: { icon: HardDriveDownload, accent: "#0EA5E9" },
  health: { icon: Stethoscope, accent: "#34D399" },
  audit: { icon: ScrollText, accent: "#34D399" },
  settings: { icon: SettingsIcon, accent: "#A3A3A3" }
};
