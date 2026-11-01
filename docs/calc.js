// Berechnungslogik Kraftaufbau-App (SPEC §5) – reine Funktionen, ohne DOM.
(function (root) {
  'use strict';
  const DAY = 86400000;

  // §5.1 Formel als Strategie – später z. B. Brzycki wählbar
  const FORMULAS = {
    epley: (w, r) => w * (1 + r / 30),
    brzycki: (w, r) => w * 36 / (37 - r),
  };
  const MAX_EST_REPS = 10;
  let formula = 'epley';

  function setFormula(name) { if (FORMULAS[name]) formula = name; }

  function round1(x) { return Math.round(x * 10) / 10; }

  /** Geschätztes 1RM eines Satzes; null = keine Schätzung. */
  function e1rm(weightKg, reps, rir) {
    const eff = reps + (rir ?? 0);
    if (!(weightKg > 0) || !(eff >= 1)) return null;
    if (eff === 1) return weightKg;
    if (eff > MAX_EST_REPS) return null;
    return FORMULAS[formula](weightKg, eff);
  }

  function setE1rm(set, ex) {
    if (!ex || ex.mode !== 'reps') return null;
    return e1rm(set.weightKg, set.reps, set.rir);
  }

  // --- Datum / ISO-KW ---
  function toIso(d) { return new Date(d).toISOString().slice(0, 10); }
  function addDays(iso, n) { return toIso(Date.parse(iso + 'T00:00:00Z') + n * DAY); }
  function isoWeek(iso) {
    const t = Date.parse(iso + 'T00:00:00Z');
    const dow = (new Date(t).getUTCDay() + 6) % 7;
    const mon = t - dow * DAY;
    const y = new Date(mon + 3 * DAY).getUTCFullYear();
    const jan4 = Date.UTC(y, 0, 4);
    const jan4mon = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
    const week = 1 + Math.round((mon - jan4mon) / (7 * DAY));
    return {
      year: y, week, monday: toIso(mon),
      key: y + '-W' + String(week).padStart(2, '0'),
      index: Math.round(mon / (7 * DAY)),
    };
  }

  // §5.2 Referenz-1RM an Datum D (nur Daten vor D).
  // baseline = datumsunabhängiger Vergleichswert; gilt nur, wenn kein Test und kein e1RM der letzten 28 Tage vorliegt.
  function refMax(ex, D, sets, tests, baseline) {
    if (!ex || ex.mode === 'load_only') return null;
    const bl = baseline > 0 ? { value: baseline, source: 'baseline', date: null } : null;
    let lastTest = null;
    for (const t of tests) {
      if (t.exerciseId !== ex.id || !(t.date < D)) continue;
      if (!lastTest || t.date >= lastTest.date) lastTest = t;
    }
    if (ex.mode === 'tested_only') {
      return lastTest ? { value: lastTest.weightKg, source: 'test', date: lastTest.date } : bl;
    }
    const from = addDays(D, -28);
    let best = null;
    let session = null;
    for (const s of sets) {
      if (s.exerciseId !== ex.id) continue;
      const v = setE1rm(s, ex);
      if (v == null) continue;
      if (s.date >= from && s.date < D) {
        if (!best || v > best.value) best = { value: v, source: 'e1rm28', date: s.date };
      } else if (s.date === D) {
        if (!session || v > session.value) session = { value: v, source: 'session', date: D };
      }
    }
    const test = lastTest ? { value: lastTest.weightKg, source: 'test', date: lastTest.date } : null;
    if (test || best) {
      if (!best) return test;
      if (!test) return best;
      return test.value >= best.value ? test : best;
    }
    return bl || session;
  }

  // §5.3
  function pct(weightKg, ref) {
    const r = ref && typeof ref === 'object' ? ref.value : ref;
    if (!(r > 0)) return null;
    return Math.round(weightKg / r * 100);
  }

  function suggestLoad(percent, ref, increment) {
    const inc = increment > 0 ? increment : 2.5;
    return Math.round(ref * percent / 100 / inc) * inc;
  }

  function roundTo(x, inc) { const i = inc > 0 ? inc : 2.5; return Math.round(x / i) * i; }

  // §5.4 Wochenwerte
  function weekly(ex, sets, tests, baseline) {
    const map = new Map();
    const get = (iso) => {
      const w = isoWeek(iso);
      if (!map.has(w.key)) map.set(w.key, { ...w, e1rm: null, tested: [], topLoad: null, volume: 0, pctSum: 0, pctN: 0, sets: 0 });
      return map.get(w.key);
    };
    const exSets = sets.filter((s) => s.exerciseId === ex.id);
    const exTests = tests.filter((t) => t.exerciseId === ex.id);
    for (const s of exSets) {
      const w = get(s.date);
      w.sets++;
      const v = setE1rm(s, ex);
      if (v != null && (w.e1rm == null || v > w.e1rm)) w.e1rm = v;
      if (w.topLoad == null || s.weightKg > w.topLoad) w.topLoad = s.weightKg;
      w.volume += s.weightKg * s.reps * (ex.unilateral ? 2 : 1);
      const p = pct(s.weightKg, refMax(ex, s.date, exSets, exTests, baseline));
      if (p != null) { w.pctSum += p; w.pctN++; }
    }
    for (const t of exTests) {
      const w = get(t.date);
      w.tested.push(t.weightKg);
    }
    return [...map.values()]
      .map((w) => ({ ...w, avgPct: w.pctN ? Math.round(w.pctSum / w.pctN) : null }))
      .sort((a, b) => a.index - b.index);
  }

  // §5.5 Trend: lineare Regression über die letzten 8 Wochen mit Werten
  function trend(points) {
    const pts = points.filter((p) => p.y != null).slice(-8);
    if (pts.length < 2) return null;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    let sxy = 0, sxx = 0;
    for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; }
    if (sxx === 0) return null;
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx, x0: pts[0].x, x1: pts[n - 1].x, n };
  }

  // §6.1 Schnelleingabe-Parser
  function parseQuick(input) {
    const src = String(input || '').toLowerCase()
      .replace(/kg/g, '').replace(/[×*]/g, 'x').replace(/,/g, '.').replace(/\s+/g, '');
    if (!src) return { sets: [], error: null };
    const out = [];
    for (const seg of src.split('+')) {
      if (!seg) continue;
      let body = seg, rir;
      const m = /@(\d+)$/.exec(seg);
      if (m) { rir = Number(m[1]); body = seg.slice(0, m.index); }
      if (rir != null && (rir < 0 || rir > 5)) return { sets: [], error: 'RIR muss zwischen 0 und 5 liegen.' };
      let mm;
      if ((mm = /^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+)x(\d+)$/.exec(body))) {
        const reps = Number(mm[2]);
        for (const w of mm[1].split('/')) out.push({ weightKg: Number(w), reps, rir });
      } else if ((mm = /^(\d+)x(\d+)x(\d+(?:\.\d+)?)$/.exec(body))) {
        const n = Number(mm[1]);
        if (n < 1 || n > 20) return { sets: [], error: 'Höchstens 20 Sätze pro Eingabe.' };
        for (let i = 0; i < n; i++) out.push({ weightKg: Number(mm[3]), reps: Number(mm[2]), rir });
      } else if ((mm = /^(\d+(?:\.\d+)?)x(\d+)$/.exec(body))) {
        out.push({ weightKg: Number(mm[1]), reps: Number(mm[2]), rir });
      } else {
        return { sets: [], error: '«' + seg + '» nicht erkannt. Beispiele: 5x5x80 · 80x5 · 100/110/120x5 · 5x5x80@2' };
      }
    }
    for (const s of out) {
      if (!(s.reps >= 1 && s.reps <= 50)) return { sets: [], error: 'Wiederholungen: 1 bis 50.' };
      if (!(s.weightKg > 0 && s.weightKg <= 500)) return { sets: [], error: 'Gewicht: mehr als 0 und höchstens 500 kg.' };
    }
    return { sets: out, error: null };
  }

  // --- Wurf (Hammer) und Allgemeine Tests ---
  const HAMMER_MASSES = [5, 6, 7.26, 7.8, 8, 8.5, 9, 10, 11, 12];
  const WIRES = [
    { id: 'normal', label: 'Normal', cm: 121.5 },
    { id: '110', label: '110 cm', cm: 110 },
    { id: '100', label: '100 cm', cm: 100 },
    { id: '75', label: '75 cm', cm: 75 },
  ];
  const SHOT_MASSES = [4, 5, 6, 7];
  const TESTS = [
    { id: 'sprint30', name: '30 m Sprint', unit: 's', lowerBetter: true, min: 2, max: 10 },
    { id: 'kugel_vor', name: 'Kugelschocken vorwärts', unit: 'm', shot: true, min: 1, max: 40 },
    { id: 'kugel_rueck', name: 'Kugelschocken rückwärts', unit: 'm', shot: true, min: 1, max: 40 },
    { id: 'standweit', name: 'Standweitsprung', unit: 'm', min: 0.5, max: 4.5 },
    { id: 'frosch3', name: '3x Froschsprung', unit: 'm', min: 1, max: 15 },
  ];

  function isBetter(a, b, lowerBetter) { return b == null || (lowerBetter ? a < b : a > b); }

  /** Bestwert pro ISO-KW; entries: [{date, value, flag?}] – flag markiert z. B. Wettkämpfe. */
  function weeklyBest(entries, lowerBetter) {
    const map = new Map();
    for (const e of entries) {
      const w = isoWeek(e.date);
      if (!map.has(w.key)) map.set(w.key, { ...w, best: null, n: 0, flagged: [] });
      const m = map.get(w.key);
      m.n++;
      if (isBetter(e.value, m.best, lowerBetter)) m.best = e.value;
      if (e.flag) m.flagged.push(e.value);
    }
    return [...map.values()].sort((a, b) => a.index - b.index);
  }

  // §5.6 Testfälle
  function selfTest() {
    const r = [];
    const eq = (name, got, want) => r.push({ name, got, want, pass: got === want });
    eq('80 kg × 5 → e1RM 93.3', round1(e1rm(80, 5)), 93.3);
    eq('100 kg × 1 → e1RM 100.0', round1(e1rm(100, 1)), 100);
    eq('140 kg × 5, RIR 1 → e1RM 168.0', round1(e1rm(140, 5, 1)), 168);
    eq('70 kg × 12 → keine Schätzung', e1rm(70, 12), null);
    eq('80 kg bei Referenz 93.3 → 86 %', pct(80, 93.3), 86);
    eq('85 % von 93.3, Schritt 2.5 → 80 kg', suggestLoad(85, 93.3, 2.5), 80);
    return r;
  }

  const api = {
    e1rm, setE1rm, setFormula, refMax, pct, suggestLoad, roundTo, weekly, trend, parseQuick, isoWeek, addDays, toIso, round1, selfTest, FORMULAS,
    HAMMER_MASSES, WIRES, SHOT_MASSES, TESTS, isBetter, weeklyBest,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
