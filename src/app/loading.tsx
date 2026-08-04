export default function Loading() {
  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <section
        className="notice"
        aria-labelledby="digest-loading"
        aria-live="polite"
      >
        <div>
          <p className="eyebrow">Loading the edition</p>
          <h1 id="digest-loading">Fetching today’s reading.</h1>
        </div>
        <p>The stories and their HN threads are almost ready.</p>
      </section>
    </main>
  );
}
