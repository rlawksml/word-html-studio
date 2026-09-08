const INITIAL_KEYS = Object.freeze([
  "r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g",
]);

const MEDIAL_KEYS = Object.freeze([
  "k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l",
]);

const FINAL_KEYS = Object.freeze([
  "", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "T", "d", "w", "c", "z", "x", "v", "g",
]);

const COMPATIBILITY_JAMO_KEYS = Object.freeze({
  ㄱ: "r", ㄲ: "R", ㄳ: "rt", ㄴ: "s", ㄵ: "sw", ㄶ: "sg", ㄷ: "e", ㄸ: "E",
  ㄹ: "f", ㄺ: "fr", ㄻ: "fa", ㄼ: "fq", ㄽ: "ft", ㄾ: "fx", ㄿ: "fv", ㅀ: "fg",
  ㅁ: "a", ㅂ: "q", ㅃ: "Q", ㅄ: "qt", ㅅ: "t", ㅆ: "T", ㅇ: "d", ㅈ: "w",
  ㅉ: "W", ㅊ: "c", ㅋ: "z", ㅌ: "x", ㅍ: "v", ㅎ: "g",
  ㅏ: "k", ㅐ: "o", ㅑ: "i", ㅒ: "O", ㅓ: "j", ㅔ: "p", ㅕ: "u", ㅖ: "P",
  ㅗ: "h", ㅘ: "hk", ㅙ: "ho", ㅚ: "hl", ㅛ: "y", ㅜ: "n", ㅝ: "nj", ㅞ: "np",
  ㅟ: "nl", ㅠ: "b", ㅡ: "m", ㅢ: "ml", ㅣ: "l",
});

const HANGUL_SYLLABLE_BASE = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const MEDIAL_COUNT = 21;
const FINAL_COUNT = 28;
const SYLLABLES_PER_INITIAL = MEDIAL_COUNT * FINAL_COUNT;

function canonicalJamoKey(codePoint) {
  if (codePoint >= 0x1100 && codePoint <= 0x1112) return INITIAL_KEYS[codePoint - 0x1100];
  if (codePoint >= 0x1161 && codePoint <= 0x1175) return MEDIAL_KEYS[codePoint - 0x1161];
  if (codePoint >= 0x11a8 && codePoint <= 0x11c2) return FINAL_KEYS[codePoint - 0x11a7];
  return "";
}

/**
 * 한글 두벌식 결과와 실제 영문 키 입력을 같은 ASCII 키 조합으로 맞춥니다.
 * 일반 영문·숫자·기호와 대소문자는 그대로 두어 기존 암호의 의미를 바꾸지 않습니다.
 */
export function canonicalizeAccessCode(value) {
  const normalized = typeof value === "string" ? value.normalize("NFC").trim() : "";
  let result = "";

  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= HANGUL_SYLLABLE_BASE && codePoint <= HANGUL_SYLLABLE_END) {
      const syllableIndex = codePoint - HANGUL_SYLLABLE_BASE;
      const initialIndex = Math.floor(syllableIndex / SYLLABLES_PER_INITIAL);
      const medialIndex = Math.floor((syllableIndex % SYLLABLES_PER_INITIAL) / FINAL_COUNT);
      const finalIndex = syllableIndex % FINAL_COUNT;
      result += INITIAL_KEYS[initialIndex] + MEDIAL_KEYS[medialIndex] + FINAL_KEYS[finalIndex];
      continue;
    }

    const compatibilityKey = COMPATIBILITY_JAMO_KEYS[character];
    if (compatibilityKey) {
      result += compatibilityKey;
      continue;
    }

    const jamoKey = canonicalJamoKey(codePoint);
    result += jamoKey || character;
  }

  return result;
}

export function accessCodesMatch(configured, submitted) {
  const expected = canonicalizeAccessCode(configured);
  const actual = canonicalizeAccessCode(submitted);
  return Boolean(expected && actual && expected === actual);
}
