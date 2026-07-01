import {
  Activity, Calculator, CalendarClock, CalendarDays, ClipboardList, CloudSun, Code2, Command,
  HardDriveDownload, Inbox, LayoutGrid, Lightbulb, Newspaper, NotebookPen, PackageSearch,
  ScrollText, Settings as SettingsIcon, Share2, Sparkles, Stethoscope, Vault, Wallet, Wrench,
  type LucideIcon
} from "lucide-react";

// Icon + accent for each module, shared across the shell and module views.
export const MODULE_META: Record<string, { icon: LucideIcon; accent: string }> = {
  command: { icon: Command, accent: "#22D3EE" },
  dev: { icon: Code2, accent: "#3B82F6" },
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
