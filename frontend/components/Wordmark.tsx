/**
 * URNA.
 *
 * Colour settles into the base of the word, the way something rests in the
 * bottom of a vessel: you see a little of what is in there, never the whole of
 * it.
 *
 * The colours are the Romanian flag, which is also where the name comes from —
 * *urna* is the Romanian word, inherited unchanged from the Latin, for the
 * vessel a lot is drawn from.
 *
 * They are laid as three equal bands across the whole word rather than one
 * colour per letter. URNA has four letters and the flag has three colours, so
 * per-letter would mean repeating one and losing the flag. Banding also puts
 * the transitions wherever they fall inside a stroke, which looks deliberate
 * rather than aligned.
 *
 * The band sits at one height across the word, never stepped. Distinct
 * participants, indistinguishable amounts — the product's entire claim. A
 * mark with varying levels would have been prettier and would have
 * contradicted the thing it stands for.
 */

const FLAG = ["#6699FF", "#FFD24D", "#FF5C5C"] as const;

/**
 * Width the word is pinned to.
 *
 * The bands divide this into thirds, so it has to be the width of the letters
 * themselves rather than of a roomier canvas — otherwise the last band starts
 * past the final stroke and the third colour barely appears. `textLength`
 * below holds the word to exactly this, which also means the mark does not
 * shift when a fallback font is briefly in use.
 *
 * 196 is a touch above the natural width at this size, so the adjustment is
 * spread across three gaps and is not visible.
 */
const VIEW_WIDTH = 196;
const BAND_TOP = 52;
const BAND_HEIGHT = 28;

export function Wordmark({ height = 26 }: { height?: number }) {
  // Proportions are fixed to the viewBox rather than measured, so the mark is
  // identical everywhere and never reflows while a webfont loads.
  const width = Math.round(height * (VIEW_WIDTH / 80));

  // `spacing` widens the gaps to reach the target and leaves the glyphs
  // untouched. `spacingAndGlyphs` would stretch the letterforms themselves,
  // which is visible immediately in a wordmark.
  const pin = { textLength: VIEW_WIDTH, lengthAdjust: "spacing" as const };

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} 80`}
      height={height}
      width={width}
      className="wordmark"
      role="img"
      aria-label="URNA"
    >
      <defs>
        {/*
          The letters themselves become the clip, so colour can only appear
          inside a stroke of the word. Coloured rectangles drawn behind the
          text would spill into the counters and the gaps between letters.
        */}
        <clipPath id="wordmark-letters">
          <text x="0" y="62" className="wordmark-text" {...pin}>
            URNA
          </text>
        </clipPath>
      </defs>

      <text x="0" y="62" className="wordmark-text wordmark-ink" {...pin}>
        URNA
      </text>

      <g clipPath="url(#wordmark-letters)">
        {FLAG.map((colour, index) => (
          <rect
            key={colour}
            x={(index * VIEW_WIDTH) / FLAG.length}
            // One height across the whole word, never stepped per letter.
            y={BAND_TOP}
            // Half a unit of overlap, so no hairline of background shows
            // through where two bands meet after rounding.
            width={VIEW_WIDTH / FLAG.length + 0.5}
            height={BAND_HEIGHT}
            fill={colour}
          />
        ))}
      </g>
    </svg>
  );
}
