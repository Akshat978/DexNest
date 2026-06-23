import type { DexNestModuleCard } from "@dexnest/shared-types";
import "./styles.css";

const modules: DexNestModuleCard[] = [
  {
    id: "command",
    title: "Command",
    description: "DexNest home base for launching local modules.",
    status: "available"
  },
  {
    id: "dev",
    title: "Dev",
    description: "Project workspace dashboard placeholder.",
    status: "placeholder"
  },
  {
    id: "deck",
    title: "Deck",
    description: "Local action endpoint placeholder.",
    status: "placeholder"
  },
  {
    id: "clipboard",
    title: "Clipboard",
    description: "Clipboard module reserved for a later phase.",
    status: "placeholder"
  },
  {
    id: "drop",
    title: "Drop",
    description: "Drop module reserved for a later phase.",
    status: "placeholder"
  }
];

export function CommandHome() {
  return (
    <section className="command-home" aria-labelledby="command-title">
      <div className="command-home__header">
        <p className="command-home__eyebrow">DexNest</p>
        <h1 id="command-title">Command</h1>
        <p>Offline-first desktop command center. Local modules only.</p>
      </div>

      <div className="command-home__grid">
        {modules.map((module) => (
          <article className="command-card" key={module.id}>
            <div>
              <h2>{module.title}</h2>
              <p>{module.description}</p>
            </div>
            <span className="command-card__status">{module.status}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
