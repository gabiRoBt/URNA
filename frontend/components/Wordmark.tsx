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
 * They are laid as three bands across the whole word rather than one colour
 * per letter. URNA has four letters and the flag has three colours, so
 * per-letter would mean repeating one and losing the flag.
 *
 * The band sits at one height across the word, never stepped. Distinct
 * participants, indistinguishable amounts — the product's entire claim. A
 * mark with varying levels would have been prettier and would have
 * contradicted the thing it stands for.
 */

/**
 * Width the word is pinned to.
 *
 * `textLength` below holds the word to exactly this, which fixes the geometry
 * the bands are cut against and also means the mark does not shift while a
 * fallback font is briefly in use.
 *
 * 196 is a touch above the natural width at this size, so the adjustment is
 * spread across three gaps and is not visible.
 */
const VIEW_WIDTH = 196;
const BAND_TOP = 52;
const BAND_HEIGHT = 28;

/**
 * Where one colour gives way to the next.
 *
 * Not equal thirds. Thirds put a boundary at 130.7, which lands inside the
 * stroke where the N's diagonal meets its right leg and slices that leg into
 * two colours — the look of a misregistered print run, not of a decision.
 *
 * These stops were measured against the real face at the band's own height,
 * where the letters are only their bottom tenth and the strokes are much
 * narrower than the letters are wide. In that strip the ink sits at:
 *
 *     U bowl   6–40    R stem 55–64   R leg  77–91
 *     N stem  104–112  N leg 126–141  A     152–163, 182–194
 *
 * so 48 and 119 fall in the two widest voids — the gap after the U, and the
 * open counter of the N. Every transition happens over background, which is
 * why none of them is visible: you see three blocks of colour and no seams.
 *
 * The split is also near even by ink rather than by width — 35, 33 and 41
 * units of covered stroke. Equal widths would not have been equal colour,
 * because the letters do not carry equal weight down here.
 */
const BANDS = [
  { colour: "#6699FF", from: 0, to: 48 },
  { colour: "#FFD24D", from: 48, to: 119 },
  { colour: "#FF5C5C", from: 119, to: VIEW_WIDTH },
] as const;

export function Wordmark({ height = 36 }: { height?: number }) {
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
        {BANDS.map((band, index) => (
          <rect
            key={band.colour}
            x={band.from}
            // One height across the whole word, never stepped per letter.
            y={BAND_TOP}
            // Half a unit of overlap between neighbours. The stops sit over
            // background so nothing should show through anyway, but if the
            // face ever falls back the shapes move and this keeps a hairline
            // of ground from appearing in the join.
            width={band.to - band.from + (index === BANDS.length - 1 ? 0 : 0.5)}
            height={BAND_HEIGHT}
            fill={band.colour}
          />
        ))}
      </g>
    </svg>
  );
}
