import type { ArticleExtraction } from "./extractor";

export type EvidenceLocation =
  | {
      readonly kind: "heading";
      readonly heading: string;
      readonly level: number;
    }
  | {
      readonly kind: "line_range";
      readonly startLine: number;
      readonly endLine: number;
    }
  | { readonly kind: "section"; readonly section: string }
  | { readonly kind: "entry"; readonly entryId: string }
  | { readonly kind: "file_path"; readonly path: string }
  | { readonly kind: "page"; readonly page: number };

export interface AdapterInput {
  readonly body: string | Uint8Array;
  readonly sourceUrl: URL;
  readonly contentType: string;
}

export interface SourceDocumentAdapter {
  readonly id: string;
  readonly contentTypes: ReadonlySet<string>;
  matches(input: AdapterInput): boolean;
  extract(input: AdapterInput): ArticleExtraction;
}

export type AdapterResult =
  | {
      readonly status: "handled";
      readonly adapterId: string;
      readonly extraction: ArticleExtraction;
    }
  | {
      readonly status: "unsupported";
      readonly reason: "no_matching_adapter";
    };

/** Deterministic, first-match registry. Registration order is part of its contract. */
export class SourceDocumentAdapterRegistry {
  private readonly adapters: readonly SourceDocumentAdapter[];

  constructor(adapters: readonly SourceDocumentAdapter[]) {
    const ids = new Set<string>();
    for (const adapter of adapters) {
      if (!adapter.id || ids.has(adapter.id)) {
        throw new Error(
          `Source adapter IDs must be non-empty and unique: ${adapter.id}`,
        );
      }
      ids.add(adapter.id);
    }
    this.adapters = [...adapters];
  }

  extract(input: AdapterInput): AdapterResult {
    const adapter = this.adapters.find(
      (candidate) =>
        candidate.contentTypes.has(input.contentType) &&
        candidate.matches(input),
    );
    if (!adapter)
      return { status: "unsupported", reason: "no_matching_adapter" };
    return {
      status: "handled",
      adapterId: adapter.id,
      extraction: adapter.extract(input),
    };
  }
}
