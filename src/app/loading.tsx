export default function Loading() {
  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <section
        className="notice"
        aria-labelledby="digest-loading"
        aria-live="polite"
      >
        <div>
          <p className="eyebrow">Loading edition</p>
          <h1 id="digest-loading">Opening the latest digest.</h1>
        </div>
        <p>Collecting the article and discussion analysis for this view.</p>
      </section>
    </main>
  );
}
