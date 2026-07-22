export default function Home() {
  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <section className="page-intro" aria-labelledby="page-title">
        <p className="eyebrow">The latest edition</p>
        <h1 id="page-title">A clearer read on Hacker News.</h1>
        <p className="page-intro__summary">
          Source-grounded summaries of leading stories, paired with the ideas,
          disagreements, and hard-won context from their discussions.
        </p>
      </section>

      <section className="notice" aria-labelledby="digest-status">
        <div>
          <p className="eyebrow">Digest status</p>
          <h2 id="digest-status">The first edition is being prepared.</h2>
        </div>
        <p>
          The collection and analysis pipeline is taking shape. Published runs
          will appear here in ranked reading order.
        </p>
      </section>
    </main>
  );
}
