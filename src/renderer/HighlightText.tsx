export interface HighlightSegment {
  text: string;
  hit: boolean;
}

const MAX_SEGMENTS = 200;

export function splitHighlightSegments(
  text: string,
  terms: readonly string[]
): HighlightSegment[] {
  const uniqueTerms = [
    ...new Set(terms.map((term) => term.trim().toLowerCase()))
  ].filter((term) => term.length > 0);
  if (uniqueTerms.length === 0) {
    return [{ text, hit: false }];
  }

  const segments: HighlightSegment[] = [];
  const lowerText = text.toLowerCase();
  let cursor = 0;

  while (segments.length < MAX_SEGMENTS) {
    let best = -1;
    let bestLength = 0;
    for (const term of uniqueTerms) {
      const at = lowerText.indexOf(term, cursor);
      if (at >= 0 && (best === -1 || at < best)) {
        best = at;
        bestLength = term.length;
      }
    }
    if (best === -1) {
      break;
    }
    if (best > cursor) {
      segments.push({ text: text.slice(cursor, best), hit: false });
    }
    segments.push({ text: text.slice(best, best + bestLength), hit: true });
    cursor = best + bestLength;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), hit: false });
  }
  return segments.length > 0 ? segments : [{ text, hit: false }];
}

export function HighlightText({
  text,
  terms
}: {
  text: string;
  terms: readonly string[];
}) {
  const segments = splitHighlightSegments(text, terms);
  if (segments.length === 1 && !segments[0].hit) {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.hit ? (
          <mark className="log-hl" key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}
