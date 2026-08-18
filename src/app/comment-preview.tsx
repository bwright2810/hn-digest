"use client";

import { useEffect, useId, useRef, useState } from "react";

export function CommentPreview({
  author,
  text,
  score,
  href,
}: {
  readonly author: string;
  readonly text: string | null;
  readonly score: number | null;
  readonly href: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLAnchorElement>(null);
  const previewId = useId();
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(448, window.innerWidth - 32);
      setPosition({
        top: rect.bottom + 8,
        left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);

  return (
    <span className="comment-preview" ref={container}>
      <a
        ref={anchor}
        className="comment-preview__author"
        href={href}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {author}
      </a>
      <button
        className="comment-preview__toggle"
        type="button"
        aria-expanded={open}
        aria-controls={previewId}
        aria-label={`Preview comment by ${author}`}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
      {open ? (
        <span
          className="comment-preview__body"
          id={previewId}
          role="region"
          aria-label={`Comment by ${author}`}
          style={position ?? undefined}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <span className="comment-preview__text">
            {text ?? "Comment unavailable."}
          </span>
          <span className="comment-preview__score">
            {score === null ? "Score unavailable" : `Score: ${score}`}
          </span>
          <a href={href}>Open comment on Hacker News</a>
        </span>
      ) : null}
    </span>
  );
}
