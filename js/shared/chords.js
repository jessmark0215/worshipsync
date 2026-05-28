// ============================================================
// WORSHIPSYNC · js/shared/chords.js
// Chord-chart transpose utility. Pure functions — no DOM, no Firebase.
//
// Used by the Audio Studio's chord-chart panel: when the MD hits the
// up/down arrow, every chord in the chord text gets shifted by one
// semitone. Non-chord text (verse labels, lyrics, blank lines) is
// preserved exactly.
// ============================================================

// Canonical sharp-spelling pitch names. Flat inputs (Bb, Eb) are
// normalized to sharps internally, then we choose a sensible output
// spelling based on the target key (Bb major prefers flats, etc.)
const PITCH_NAMES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PITCH_NAMES_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

// Map any input spelling (sharp or flat) to its 0..11 semitone index.
const PITCH_INDEX = (() => {
  const m = {};
  PITCH_NAMES_SHARP.forEach((n, i) => { m[n] = i; });
  PITCH_NAMES_FLAT.forEach((n, i) => { m[n] = i; });
  return m;
})();

// Keys that conventionally use flats vs sharps. Used to pick a tidy
// output spelling so transposing G→Ab gives "Ab" rather than "G#".
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
                           'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm']);

// A chord token: root note + optional quality/extension + optional /bass
// Examples that match: C, Cm, C7, Cm7, Cmaj7, C/E, F#m, Bbsus4, A°, C+, Dadd9
// We use word boundaries and uppercase-letter anchoring so we don't grab
// "Em" out of the word "Empty" or "A" out of "Amen".
const CHORD_REGEX = /(?<![A-Za-z0-9])([A-G])(#|b)?((?:maj|min|m|sus|add|dim|aug|°|\+)?\d?\d?)((?:[\/\\]([A-G])(#|b)?)?)(?![A-Za-z])/g;

// Shift a single chord by `semitones` and return the new chord text.
// Preserves quality (m7, sus4, etc.) and bass note (/E → /F#).
function transposeChord(match, root, accidental, quality, bassWhole, bassRoot, bassAcc, preferFlats) {
  const inputName = root + (accidental || '');
  if (!(inputName in PITCH_INDEX)) return match; // safety net

  const idx = PITCH_INDEX[inputName];
  const newIdx = (((idx + semitones) % 12) + 12) % 12;
  const newRoot = preferFlats ? PITCH_NAMES_FLAT[newIdx] : PITCH_NAMES_SHARP[newIdx];

  let newBass = '';
  if (bassWhole && bassRoot) {
    const bassInput = bassRoot + (bassAcc || '');
    if (bassInput in PITCH_INDEX) {
      const bIdx = PITCH_INDEX[bassInput];
      const nbIdx = (((bIdx + semitones) % 12) + 12) % 12;
      const sep = bassWhole[0]; // '/' or '\'
      newBass = sep + (preferFlats ? PITCH_NAMES_FLAT[nbIdx] : PITCH_NAMES_SHARP[nbIdx]);
    } else {
      newBass = bassWhole;
    }
  }

  return newRoot + (quality || '') + newBass;
}

// shared lexical scope for the regex callback (avoids stuffing the value
// into the regex string itself)
let semitones = 0;

// Transpose every chord in `text` by `semitones` semitones. Returns new text.
// `targetKey` (optional) controls sharp vs flat spelling of the output;
// if omitted we infer from the sign of the shift and the first chord found.
export function transposeText(text, n, targetKey = null) {
  if (!text) return text;
  semitones = n;
  const preferFlats = targetKey
    ? FLAT_KEYS.has(targetKey)
    : (n < 0); // downward transpositions tend to land in flat keys

  return text.replace(CHORD_REGEX, (m, root, acc, qual, bassWhole, bassRoot, bassAcc) =>
    transposeChord(m, root, acc, qual, bassWhole, bassRoot, bassAcc, preferFlats)
  );
}

// Transpose a single chord token (e.g. "Gm7") for chip displays.
// Returns the new token, or the original string if it can't be parsed.
export function transposeOne(chord, n) {
  if (!chord) return chord;
  semitones = n;
  return chord.replace(CHORD_REGEX, (m, root, acc, qual, bassWhole, bassRoot, bassAcc) =>
    transposeChord(m, root, acc, qual, bassWhole, bassRoot, bassAcc, n < 0)
  );
}

// Distance in semitones between two key names (e.g. keyDistance('G', 'A') === 2).
// Returns 0 if either key is unrecognized. Ignores trailing 'm' for minor keys.
export function keyDistance(from, to) {
  if (!from || !to) return 0;
  const a = from.replace(/m$/, '');
  const b = to.replace(/m$/, '');
  if (!(a in PITCH_INDEX) || !(b in PITCH_INDEX)) return 0;
  const diff = PITCH_INDEX[b] - PITCH_INDEX[a];
  // Return a signed value in -6..+6 so transposing "up to" the nearest
  // direction works (e.g. C → Bb is -2, not +10).
  if (diff > 6) return diff - 12;
  if (diff < -6) return diff + 12;
  return diff;
}

// Convenience: shift a key name by N semitones, returning the new key name.
// Preserves the 'm' suffix for minor keys.
export function shiftKey(key, n) {
  if (!key) return key;
  const isMinor = /m$/.test(key);
  const base = key.replace(/m$/, '');
  if (!(base in PITCH_INDEX)) return key;
  const idx = PITCH_INDEX[base];
  const newIdx = (((idx + n) % 12) + 12) % 12;
  // Choose spelling based on the target key's conventional preference
  const sharpName = PITCH_NAMES_SHARP[newIdx];
  const flatName = PITCH_NAMES_FLAT[newIdx];
  const sharpKey = sharpName + (isMinor ? 'm' : '');
  const flatKey = flatName + (isMinor ? 'm' : '');
  return FLAT_KEYS.has(flatKey) ? flatKey : sharpKey;
}
