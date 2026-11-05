import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keepValidPublicationMonth, publicationCalendarDays } from "../lib/workspace-formatters.ts";

const invalidStrings = [
  "", "2", "20", "202", "2026", "2026-", "2026-0", "2026-1", "2026-00", "2026-13",
  "2026-001", "2026--1", "2026-+1", "2026/01", "2026-01-01", "02026-01", "10000-01",
  "2026-01\n", "2026-01\r", "2026-01\r\n", " 2026-01", "2026-01 ", "\t2026-01", "２０２６-０１",
  "9".repeat(10_000),
];

// Exact pre-fix calculation model, not a reproduction of a mounted browser UI.
function legacyCalendarDays(month) {
  const [year, numericMonth] = month.split("-").map(Number);
  const first = new Date(year, numericMonth - 1, 1).getDay();
  const count = new Date(year, numericMonth, 0).getDate();
  return [...Array(first).fill(null), ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)];
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test("PMONTH-01 valid→invalid→valid transitions preserve the last accepted month", () => {
  let month = "2026-11";
  month = keepValidPublicationMonth(month, "");
  assert.equal(month, "2026-11");
  month = keepValidPublicationMonth(month, "2026-12");
  assert.equal(month, "2026-12");
  month = keepValidPublicationMonth(month, "2026-1");
  assert.equal(month, "2026-12");
  month = keepValidPublicationMonth(month, "2027-01");
  assert.equal(month, "2027-01");
});

test("PMONTH-02 queued functional-update model uses each latest accepted value, not a captured render value", () => {
  const candidates = ["2026-12", "", "2026-1", "2027-01", "\n", "2027-02"];
  const updates = candidates.map((candidate) => (previous) => keepValidPublicationMonth(previous, candidate));
  let month = "2026-11";
  const observed = updates.map((update) => (month = update(month)));
  assert.deepEqual(observed, ["2026-12", "2026-12", "2026-12", "2027-01", "2027-01", "2027-02"]);
});

test("PMONTH-03 empty, partial years, whitespace, newlines and noncanonical string months are rejected", () => {
  for (const candidate of invalidStrings) {
    assert.equal(keepValidPublicationMonth("2026-11", candidate), "2026-11");
    assert.deepEqual(publicationCalendarDays(candidate), []);
  }
});

test("PMONTH-04 nonstrings are rejected without coercing user-supplied objects", () => {
  let coercions = 0;
  const coercionTrap = { [Symbol.toPrimitive]() { coercions++; throw new Error("must not coerce"); } };
  for (const candidate of [undefined, null, false, true, 0, 202611, NaN, Infinity, 202611n,
    Symbol("month"), [], {}, () => {}, Object("2026-11"), coercionTrap]) {
    assert.equal(keepValidPublicationMonth("2026-11", candidate), "2026-11");
    assert.deepEqual(publicationCalendarDays(candidate), []);
  }
  assert.equal(coercions, 0);
});

test("PMONTH-05 same valid month stays exact; invalid candidates never trim or substitute the current month", () => {
  for (const previous of ["0000-01", "0099-12", "2026-06", "9999-12"]) {
    assert.equal(keepValidPublicationMonth(previous, previous), previous);
    assert.equal(keepValidPublicationMonth(previous, " 2027-01 "), previous);
    assert.equal(keepValidPublicationMonth(previous, ""), previous);
  }
  assert.equal(keepValidPublicationMonth("2026-11", "0000-01"), "0000-01");
  assert.equal(keepValidPublicationMonth("2026-11", "9999-12"), "9999-12");
});

test("PMONTH-06 leap/common February lengths and last-day strings match the existing Date calendar", () => {
  for (const [month, count] of [["1900-02", 28], ["2000-02", 29], ["2024-02", 29], ["2025-02", 28], ["2100-02", 28]]) {
    const dates = publicationCalendarDays(month).filter((day) => day !== null);
    assert.equal(dates.length, count);
    assert.equal(dates[0], `${month}-01`);
    assert.equal(dates.at(-1), `${month}-${count}`);
  }
});

test("PMONTH-07 all twelve normal-year months preserve 28/30/31 days without trailing padding", () => {
  const expected = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let index = 0; index < expected.length; index++) {
    const month = `2026-${String(index + 1).padStart(2, "0")}`;
    const cells = publicationCalendarDays(month);
    assert.equal(cells.filter((day) => day !== null).length, expected[index]);
    assert.equal(cells.at(-1), `${month}-${expected[index]}`);
  }
});

test("PMONTH-08 Sunday-through-Saturday starts retain exactly the original leading null cells", () => {
  const months = ["2026-02", "2026-06", "2026-09", "2026-04", "2026-01", "2026-05", "2026-08"];
  months.forEach((month, first) => {
    const cells = publicationCalendarDays(month);
    assert.deepEqual(cells.slice(0, first), Array(first).fill(null));
    assert.equal(cells[first], `${month}-01`);
    assert.equal(cells.filter((day) => day === null).length, first);
  });
});

test("PMONTH-09 December/January boundary keeps the selected year and does not fill adjacent-month dates", () => {
  const december = publicationCalendarDays("2026-12").filter((day) => day !== null);
  const january = publicationCalendarDays("2027-01").filter((day) => day !== null);
  assert.equal(december.at(-1), "2026-12-31");
  assert.equal(january[0], "2027-01-01");
  assert.ok(december.every((day) => day.startsWith("2026-12-")));
  assert.ok(january.every((day) => day.startsWith("2027-01-")));
});

test("PMONTH-10 valid calendar cells equal the pre-fix calculation, including unchanged 0000–0099 Date interpretation", () => {
  // Numeric Date years 0..99 mean 1900..1999, not proleptic Gregorian years.
  // Preserve that existing limitation; the output prefix still uses the input text.
  for (const year of ["0000", "0001", "0004", "0099", "0100", "1900", "2000", "2026", "2100", "9999"]) {
    for (let numericMonth = 1; numericMonth <= 12; numericMonth++) {
      const month = `${year}-${String(numericMonth).padStart(2, "0")}`;
      assert.deepEqual(publicationCalendarDays(month), legacyCalendarDays(month));
    }
  }
  assert.equal(publicationCalendarDays("0000-02").filter((day) => day !== null).length, 28);
});

test("PMONTH-11 accepted calendars are bounded, unique and contain no NaN/undefined values", () => {
  for (const year of ["0000", "0099", "0100", "2024", "2026", "9999"]) {
    for (let numericMonth = 1; numericMonth <= 12; numericMonth++) {
      const month = `${year}-${String(numericMonth).padStart(2, "0")}`;
      const cells = publicationCalendarDays(month), dates = cells.filter((day) => day !== null);
      assert.ok(cells.length >= 28 && cells.length <= 37);
      assert.equal(new Set(dates).size, dates.length);
      assert.ok(dates.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day.startsWith(`${month}-`)));
      dates.forEach((day, index) => assert.equal(day, `${month}-${String(index + 1).padStart(2, "0")}`));
    }
  }
});

test("PMONTH-12 calendar arrays are independent and invalid-input arrays cannot poison later results", () => {
  const first = publicationCalendarDays("2026-11"), second = publicationCalendarDays("2026-11");
  assert.notEqual(first, second);
  first.fill("changed");
  assert.deepEqual(second, legacyCalendarDays("2026-11"));
  const invalid = publicationCalendarDays("");
  invalid.push("changed");
  assert.deepEqual(publicationCalendarDays(""), []);
});

test("PMONTH-13 pure month-transition model leaves synthetic source text and photo references unchanged", () => {
  const source = freeze({ submissions: [{ id: 1, month: "2026-06", news: [{ id: 2,
    title: "신규모집 📚", description: "첫 줄\n둘째 줄", dates: ["2026-06-17"],
    images: [{ id: 3, originalPath: "synthetic/original.jpg", previewPath: "synthetic/preview.jpg" }],
  }] }] });
  const before = JSON.stringify(source), originalNews = source.submissions[0].news;
  let month = "2026-06";
  for (const candidate of ["", "2026-", "2026-07", "2026-07\n", "2026-08"]) {
    month = keepValidPublicationMonth(month, candidate);
    publicationCalendarDays(month);
  }
  assert.equal(month, "2026-08");
  assert.equal(JSON.stringify(source), before);
  assert.equal(source.submissions[0].news, originalNews);
});

test("PMONTH-14 controller keeps the private raw setter, functional guard and calendar memo wiring", async () => {
  const formatter = await readFile(new URL("../lib/workspace-formatters.ts", import.meta.url), "utf8");
  const controller = await readFile(new URL("../hooks/use-studio-controller.ts", import.meta.url), "utf8");
  assert.match(formatter, /import \{ isDigestOrderMonth \} from "\.\/digest-order\.ts"/);
  assert.match(controller, /const \[month, setMonthState\] = useState\(initialMonth\)/);
  assert.match(controller, /const setMonth = useCallback\(\(candidate: string\) => \{\s+setMonthState\(\(previous\) => keepValidPublicationMonth\(previous, candidate\)\);\s+\}, \[\]\);/);
  assert.equal([...controller.matchAll(/\bsetMonthState\s*\(/g)].length, 1, "only the validated setter may call the raw setter");
  assert.match(controller, /const calendarDays = useMemo\(\(\) => publicationCalendarDays\(month\), \[month\]\)/);
  const publicApi = controller.slice(controller.lastIndexOf("  return {"));
  assert.match(publicApi, /\bsetMonth\b/);
  assert.doesNotMatch(publicApi, /\bsetMonthState\b/);
});

test("PMONTH-15 pre-fix empty-month pure calculation throws Array(NaN), while the guarded helper returns empty", () => {
  assert.throws(() => legacyCalendarDays(""), RangeError);
  assert.deepEqual(publicationCalendarDays(""), []);
});
