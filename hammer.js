// Hammerwurf-Prognose (SPEC_Hammer-Prognose) – reine Funktionen, ohne DOM.
(function (root) {
  'use strict';
  const DAY = 86400000;
  const COMP_MASS_KG = 7.26;       // Wettkampfgewicht Männer
  const COMP_WIRE_CM = 121.5;      // Normaldraht Männer (Maximum)
  const LB_TO_KG = 0.45359237;
  const FT_TO_M = 0.3048;
  // Literatur-Startwerte, werden mit eigenen Daten kalibriert (§6)
  const PRIOR = { f: 2.8, k: 0.10, c: 6.72, sigma0: 0.02, tau: 0.015, n0: 5, minDiff: 0.4, windowDays: 28, minWireSessions: 3 };

  const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const isComp = (m) => Math.abs(m - COMP_MASS_KG) < 1e-9;
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

  // §5 Modelle
  function modelA(d, m, f = PRIOR.f) { return d * (m + f) / (COMP_MASS_KG + f); }
  function modelB(d, m, k = PRIOR.k) { return d * (1 + k * (m - COMP_MASS_KG)); }
  function modelC(d, m, c = PRIOR.c) { return d + c * (m - COMP_MASS_KG); }
  function modelD(L, H) { if (!L || !H || H.m === L.m) return null; return L.d + (H.d - L.d) * (COMP_MASS_KG - L.m) / (H.m - L.m); }
  /** Umkehrung Modell A: erwartete Weite mit Masse m bei Wettkampf-Äquivalent P. */
  function distanceAt(P, m, f = PRIOR.f) { return P * (COMP_MASS_KG + f) / (m + f); }

  // Bestwert pro Einheit (Datum), Gewicht und Draht
  function sessionBests(throws) {
    const map = new Map();
    for (const t of throws) {
      const k = t.date + '|' + t.massKg + '|' + t.wire;
      const cur = map.get(k);
      if (!cur || t.distanceM > cur.d) map.set(k, { date: t.date, m: t.massKg, wire: t.wire, d: t.distanceM });
    }
    return [...map.values()];
  }

  // §5.5 Drahtfaktor: Median(D_normal / D_kurz) aus Einheiten mit beiden Drähten, erst ab 3 Einheiten
  function wireFactors(throws) {
    const byDM = new Map();
    for (const s of sessionBests(throws)) {
      const k = s.date + '|' + s.m;
      if (!byDM.has(k)) byDM.set(k, { m: s.m, normal: null, other: {} });
      const g = byDM.get(k);
      if (s.wire === 'normal') g.normal = s.d; else g.other[s.wire] = s.d;
    }
    const ratios = {};
    for (const g of byDM.values()) {
      if (g.normal == null) continue;
      for (const [w, d] of Object.entries(g.other)) (ratios[g.m + '|' + w] = ratios[g.m + '|' + w] || []).push(g.normal / d);
    }
    const out = {};
    for (const [k, r] of Object.entries(ratios)) out[k] = { factor: median(r), n: r.length, active: r.length >= PRIOR.minWireSessions };
    return out;
  }
  function normalizedDistance(t, wf) {
    if (t.wire === 'normal') return t.distanceM;
    const f = wf && wf[t.massKg + '|' + t.wire];
    return f && f.active ? t.distanceM * f.factor : null;
  }

  // §6 Kalibrierung
  function calibrationPairs(throws, wf) {
    const byDate = new Map();
    for (const t of throws) {
      const d = normalizedDistance(t, wf); if (d == null) continue;
      if (!byDate.has(t.date)) byDate.set(t.date, new Map());
      const g = byDate.get(t.date);
      if (!g.has(t.massKg) || d > g.get(t.massKg)) g.set(t.massKg, d);
    }
    const pairs = [];
    for (const [date, g] of byDate) {
      const dc = g.get(COMP_MASS_KG); if (dc == null) continue;
      for (const [m, dx] of g) if (Math.abs(m - COMP_MASS_KG) >= PRIOR.minDiff) pairs.push({ date, m, dx, dc });
    }
    return pairs;
  }
  function fitF(pairs) {
    if (!pairs.length) return null;
    const sse = (f, ps) => ps.reduce((a, p) => a + (Math.log(p.dc) - Math.log(modelA(p.dx, p.m, f))) ** 2, 0);
    const grid = (ps) => { let best = null; for (let i = 0; i <= 110; i++) { const f = 0.5 + i * 0.05; const e = sse(f, ps); if (!best || e < best.e) best = { f, e }; } return Math.round(best.f * 100) / 100; };
    let f = grid(pairs), used = pairs, outliers = [];
    if (pairs.length >= 4) {
      const res = pairs.map((p) => Math.log(p.dc) - Math.log(modelA(p.dx, p.m, f)));
      const med = median(res); const mad = median(res.map((r) => Math.abs(r - med)));
      if (mad > 0) {
        used = pairs.filter((p, i) => Math.abs(res[i] - med) <= 3 * mad);
        outliers = pairs.filter((p, i) => Math.abs(res[i] - med) > 3 * mad);
        if (outliers.length) f = grid(used);
      }
    }
    return { fFit: f, n: used.length, used, outliers };
  }
  function calibrate(throws) {
    const wf = wireFactors(throws);
    const fit = fitF(calibrationPairs(throws, wf));
    const n = fit ? fit.n : 0;
    const f = fit ? (PRIOR.n0 * PRIOR.f + n * fit.fFit) / (PRIOR.n0 + n) : PRIOR.f;
    const used = fit ? fit.used : [];
    const kObs = mean(used.map((p) => (p.dc / p.dx - 1) / (p.m - COMP_MASS_KG)));
    const k = kObs == null ? PRIOR.k : (PRIOR.n0 * PRIOR.k + n * kObs) / (PRIOR.n0 + n);
    let sigma0 = PRIOR.sigma0;
    if (used.length >= 8) {
      const rel = used.map((p) => p.dc / modelA(p.dx, p.m, f) - 1); const mu = mean(rel);
      sigma0 = Math.max(0.005, Math.sqrt(rel.reduce((a, r) => a + (r - mu) ** 2, 0) / (rel.length - 1)));
    }
    return { f, fFit: fit ? fit.fFit : null, k, kObs, sigma0, tau: PRIOR.tau, nPairs: n, outliers: fit ? fit.outliers : [], wireFactors: wf };
  }

  // §4 Referenzfenster: bester (normalisierter) Wurf pro Gewicht in den 28 Tagen bis D
  function windowBests(throws, D, wf, days = PRIOR.windowDays) {
    const from = addDays(D, -(days - 1));
    const map = new Map();
    for (const t of throws) {
      if (t.date < from || t.date > D) continue;
      const d = normalizedDistance(t, wf); if (d == null) continue;
      const cur = map.get(t.massKg);
      if (!cur || d > cur.d) map.set(t.massKg, { m: t.massKg, d, raw: t.distanceM, wire: t.wire, date: t.date });
    }
    return [...map.values()].sort((a, b) => a.m - b.m);
  }

  // §7 Kombination per inverser Varianz (relativ)
  function combine(parts) {
    if (!parts.length) return null;
    const W = parts.reduce((a, p) => a + p.w, 0);
    const P = parts.reduce((a, p) => a + p.w * p.P, 0) / W;
    const sigma = 1 / Math.sqrt(W);
    return { P, sigma, lo: P * (1 - 1.96 * sigma), hi: P * (1 + 1.96 * sigma), n: parts.length };
  }
  function partsFrom(bests, cal) {
    return bests.filter((b) => !isComp(b.m)).map((b) => {
      const sigma = Math.sqrt(cal.sigma0 ** 2 + (cal.tau * Math.abs(b.m - COMP_MASS_KG)) ** 2);
      return { ...b, P: modelA(b.d, b.m, cal.f), B: modelB(b.d, b.m, cal.k), C: modelC(b.d, b.m), sigma, w: 1 / sigma ** 2 };
    });
  }
  function diagnose(L, H) {
    if (!L || !H) return null;
    if (L.P < H.P * 0.98) return 'speed';
    if (H.P < L.P * 0.98) return 'strength';
    return 'balanced';
  }
  /** Prognose der 7.26-kg-Weite aus Würfen mit anderen Gewichten (ohne 7.26 kg selbst). */
  function predictFromBests(bests, cal) {
    const parts = partsFrom(bests, cal);
    const all = combine(parts);
    const L = combine(parts.filter((p) => p.m < COMP_MASS_KG));
    const H = combine(parts.filter((p) => p.m > COMP_MASS_KG));
    const lighter = bests.filter((b) => b.m < COMP_MASS_KG).sort((a, b) => b.m - a.m)[0];
    const heavier = bests.filter((b) => b.m > COMP_MASS_KG).sort((a, b) => a.m - b.m)[0];
    const comp = bests.find((b) => isComp(b.m)) || null;
    return {
      ...(all || { P: null, sigma: null, lo: null, hi: null, n: 0 }),
      parts, L, H, diag: diagnose(L, H), modelD: modelD(lighter, heavier), comp,
      gap: comp && all ? comp.d / all.P - 1 : null,
    };
  }
  function predict(throws, D, cal) {
    cal = cal || calibrate(throws);
    return predictFromBests(windowBests(throws, D, cal.wireFactors), cal);
  }

  // Statistik für Zubringerleistungen
  function pearson(x, y) {
    const n = x.length; if (n < 3) return null;
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    if (sxx === 0 || syy === 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  }
  function linreg(x, y) {
    const n = x.length; if (n < 2) return null;
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    if (sxx === 0) return null;
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx };
  }

  // Recherche 2.1: Bakarynov-Regression (NSA 1997), Sprünge in Metern; ⚠ Datenqualität des Originals
  const BAKARYNOV_INPUTS = [
    ['snatch', 'Reissen (kg)'], ['squat', 'Kniebeuge (kg)'], ['cleanJerk', 'Stossen (kg)'],
    ['shotBack', 'Kugel rückwärts 7.26 kg (m)'], ['shotFwd', 'Kugel vorwärts 7.26 kg (m)'],
    ['slj', 'Standweitsprung (m)'], ['stj', 'Standdreisprung (m)'],
  ];
  function predictBakarynov(v) {
    const missing = BAKARYNOV_INPUTS.filter(([k]) => !(v && v[k] > 0)).map(([, l]) => l);
    if (missing.length) return { value: null, missing };
    return {
      value: 18.75 - 0.132 * v.snatch + 0.155 * v.squat + 0.174 * v.cleanJerk + 1.218 * v.shotBack + 0.244 * v.shotFwd - 0.070 * v.slj - 0.514 * v.stj,
      missing: [],
    };
  }

  // §10 Testfälle
  function selfTest() {
    const r1 = (x) => x == null ? null : Math.round(x * 10) / 10;
    const r = [];
    const eq = (name, got, want) => r.push({ name, got, want, pass: got === want });
    eq('A: 8.0 kg × 55.0 m → 59.0', r1(modelA(55, 8)), 59);
    eq('A: 6.0 kg × 70.0 m → 61.2', r1(modelA(70, 6)), 61.2);
    eq('A: 8.16 kg × 60.0 m → 65.4', r1(modelA(60, 8.16)), 65.4);
    eq('A: 6.35 kg × 72.0 m → 65.5', r1(modelA(72, 6.35)), 65.5);
    eq('A: 7.26 kg × 64.0 m → 64.0', r1(modelA(64, 7.26)), 64);
    eq('B: 8.0 kg × 55.0 m → 59.1', r1(modelB(55, 8)), 59.1);
    eq('B: 6.0 kg × 70.0 m → 61.2', r1(modelB(70, 6)), 61.2);
    eq('C: 8.0 kg × 55.0 m → 60.0', r1(modelC(55, 8)), 60);
    eq('D: 6.35 × 72 + 8.16 × 60 → 66.0', r1(modelD({ m: 6.35, d: 72 }, { m: 8.16, d: 60 })), 66);
    const p = predict([{ date: '2026-10-01', massKg: 8, wire: '110', distanceM: 60 }], '2026-10-02');
    eq('Kurzdraht ohne Kalibrierung → ausgeschlossen', p.P, null);
    eq('Bakarynov mit Mittelwerten → ≈ 73.5', r1(predictBakarynov({ snatch: 148.3, squat: 219, cleanJerk: 108.1, shotBack: 18.46, shotFwd: 16.77, slj: 3.0, stj: 9.24 }).value), 73.5);
    return r;
  }

  const api = {
    COMP_MASS_KG, COMP_WIRE_CM, LB_TO_KG, FT_TO_M, PRIOR, BAKARYNOV_INPUTS,
    modelA, modelB, modelC, modelD, distanceAt, isComp, median,
    sessionBests, wireFactors, normalizedDistance, calibrationPairs, fitF, calibrate,
    windowBests, combine, predictFromBests, predict, pearson, linreg, predictBakarynov, selfTest,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Hammer = api;
})(typeof window !== 'undefined' ? window : globalThis);
