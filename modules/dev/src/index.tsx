import "./styles.css";

const projectCards = [
  {
    title: "Pinned Projects",
    detail: "No projects added yet."
  },
  {
    title: "Recent Workspaces",
    detail: "Workspace tracking will stay local."
  },
  {
    title: "Local Tools",
    detail: "Reserved for lightweight developer actions."
  }
];

export function DevDashboard() {
  return (
    <section className="dev-dashboard" aria-labelledby="dev-title">
      <div className="dev-dashboard__header">
        <p>DexNest Dev</p>
        <h2 id="dev-title">Project Cards</h2>
      </div>

      <div className="dev-dashboard__grid">
        {projectCards.map((card) => (
          <article className="dev-project-card" key={card.title}>
            <h3>{card.title}</h3>
            <p>{card.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
