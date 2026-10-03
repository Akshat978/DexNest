// The kit gallery: every visual-layer component, in each module's accent, with
// made-up data. A reference for redesign passes (docs/DESIGN_LANGUAGE.md), and
// the place to check a kit change by eye. Not part of the app.
//
// From apps/desktop:
//   npx vite --config ../../docs/integration/harness/vite.config.mjs
// then open http://127.0.0.1:5199/docs/design/gallery/index.html
//   ?accent=rpg|skills|ghost|object|autopilot|dev|heatmap...   (default: rpg)

import React from "react";
import { createRoot } from "react-dom/client";
import { Activity, Flame, Package, Sparkles, Swords, Trophy, Wrench, Zap } from "lucide-react";

import "@dexnest/shared-ui/fonts.css";
import "@dexnest/shared-ui/tokens.css";
import "../../../apps/desktop/src/renderer/styles.css";
import "../../../apps/desktop/src/renderer/theme.css";
import {
  accentStyle,
  Badge,
  BarChart,
  Button,
  Card,
  DashboardGrid,
  Hero,
  ListRow,
  Meter,
  PageHeader,
  Reveal,
  Ring,
  SectionTitle,
  Sparkline,
  StatGrid,
  StatTile
} from "../../../apps/desktop/src/renderer/components/ui/kit";

const accent = new URLSearchParams(location.search).get("accent") ?? "rpg";
const hours = [2, 1, 0, 0, 0, 0, 1, 3, 6, 8, 7, 9, 4, 6, 8, 9, 7, 5, 3, 2, 4, 3, 2, 1];
const trend = (seed: number) => Array.from({ length: 14 }, (_, i) => Math.round(10 + 8 * Math.sin((i + seed) / 2) + i));

function Gallery() {
  return (
    <main className="grain" style={{ ...accentStyle(accent), minHeight: "100vh", padding: "var(--space-6)", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <PageHeader icon={<Swords />} title="Kit gallery" subtitle={`Visual layer in --accent-${accent} · docs/DESIGN_LANGUAGE.md`} accent={accent} actions={<Button variant="primary">Primary action</Button>} />
      <Reveal>
        <Hero
          eyebrow="Level 7 · Builder"
          title="1,240 XP this month"
          visual={<Ring value={220} max={300} size={128} stroke={10} center="7" caption="level" label="Level 7, 220 of 300 XP to level 8" />}
          actions={
            <>
              <Button variant="primary" icon={<Zap />}>Start a quest</Button>
              <Button variant="ghost">History</Button>
            </>
          }
        >
          80 XP to level 8 · 12-day streak · strongest stat: Craft
        </Hero>
        <StatGrid columns={4}>
          <StatTile label="Craft" value="Lv 9" icon={<Wrench />} delta={{ label: "+40 XP", good: true }} hint="this week" />
          <StatTile label="Order" value="Lv 6" icon={<Package />} tone="info" delta={{ label: "+5 XP", good: true }} />
          <StatTile label="Lore" value="Lv 4" icon={<Sparkles />} tone="success" hint="steady" />
          <StatTile label="Streak" value="12 days" icon={<Flame />} tone="warning" delta={{ label: "-1 vs best", good: false }} />
        </StatGrid>
        <DashboardGrid
          main={
            <>
              <Card accent={accent}>
                <SectionTitle action={<Activity aria-hidden="true" style={{ width: 14, color: "var(--kit-accent)" }} />}>Activity · today</SectionTitle>
                <BarChart data={hours.map((value, h) => ({ label: String(h), value }))} labelEvery={3} label="Activity by hour today" />
              </Card>
              <Card>
                <SectionTitle count={3}>Quests</SectionTitle>
                <div style={{ display: "grid", gap: "var(--space-3)" }}>
                  <Meter label="Ship the API refactor" value={7} max={10} display="7 of 10 commits" />
                  <Meter label="Read 4 chapters" value={1} max={4} display="1 of 4" tone="info" />
                  <Meter label="Service the 3D printer" value={1} max={1} display="done" tone="success" />
                </div>
              </Card>
            </>
          }
          side={
            <>
              <Card>
                <SectionTitle>Recent</SectionTitle>
                <div style={{ display: "grid", gap: "var(--space-2)" }}>
                  <ListRow icon={<Trophy />} title="First push of the week" meta="Achievement · 2h ago" trailing={<Badge tone="accent">+50 XP</Badge>} onClick={() => undefined} />
                  <ListRow icon={<Wrench />} title="Commit observed" meta="shop-web · 3h ago" trailing="+20 XP" onClick={() => undefined} selected />
                  <ListRow icon={<Package />} title="Replace nozzle" meta="Workshop 3D printer" trailing={<Badge tone="error">overdue</Badge>} tone="error" />
                </div>
              </Card>
              <Card>
                <SectionTitle>Trends</SectionTitle>
                <div style={{ display: "grid", gap: "var(--space-3)" }}>
                  <Sparkline values={trend(0)} height={40} fill label="XP over two weeks" />
                  <Sparkline values={trend(3)} height={40} fill tone="success" label="Focus hours over two weeks" />
                </div>
              </Card>
            </>
          }
        />
      </Reveal>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
