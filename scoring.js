// Product of non-voided, non-tie leg odds for a multi-leg bet.
const getOverallOddValue = (bet) => {
  const validLegs = bet.legs.filter(
    (leg) => leg.status !== "voided" && leg.status !== "tie",
  );
  return validLegs.reduce((acc, leg) => acc * +leg.oddValue, 1.0);
};

const getBetResult = (bet) => {
  const { legs } = bet;

  const hasVoided = legs.every((leg) => leg.status === "voided");
  if (hasVoided) return "voided";

  const validLegs = legs.filter((leg) => leg.status !== "voided");

  const hasTied = validLegs.every((leg) => leg.status === "tie");
  if (hasTied) return "tie";

  // A tie leg is a PUSH, not a blocker. getOverallOddValue already drops tie
  // legs from the payout (they are worth 1.0), so they must not decide the
  // outcome either. Leaving them in the check made "every leg won" false for
  // any winning parlay containing a push, so it fell through to "pending" and
  // could never settle — while an otherwise identical parlay with a losing leg
  // settled fine. The bug therefore only ever struck bets that had won.
  const decidingLegs = validLegs.filter((leg) => leg.status !== "tie");

  const hasLost = decidingLegs.some((leg) => leg.status === "lost");
  if (hasLost) return "lost";

  const hasWon = decidingLegs.every((leg) => leg.status === "won");
  if (hasWon) return "won";

  return "pending";
};

// Extract the decimal odd for a given selection from a match odds array.
// Works for both Match.odds and Match.closingOdds (same shape).
// betType is read from the odds entry since saved bet legs don't persist it.
const getOddValueFromOdds = (oddsArray, betCategoryId, oddName) => {
  if (!Array.isArray(oddsArray) || !oddName) return null;
  const oddData = oddsArray.find((o) => String(o.id) === String(betCategoryId));
  if (!oddData || !Array.isArray(oddData.data)) return null;
  const betType = oddData.betType || "normal";
  try {
    if (betType === "total" || betType === "handicap") {
      let [side, line] = oddName.split("_");
      if (betType === "handicap" && side === "Away") {
        const sign = line.slice(0, 1);
        line = (sign === "+" ? "-" : "+") + line.slice(1);
      }
      const entry = oddData.data.find((d) => d.name === line);
      const value = entry?.values?.find((v) => v.name === side)?.value;
      return value != null && +value > 1 ? +value : null;
    }
    for (const entry of oddData.data) {
      const value = entry?.values?.find((v) => v.name === oddName)?.value;
      if (value != null && +value > 1) return +value;
    }
    return null;
  } catch {
    return null;
  }
};

// Product of each non-voided/non-tie leg's closing odd.
// Returns null if any contributing leg's closing line is missing.
// closingOddsByMatchId: Map<String(matchId) → closingOdds array>
const getBetClosingOddValue = (bet, closingOddsByMatchId) => {
  const validLegs = (bet.legs || []).filter(
    (leg) => leg.status !== "voided" && leg.status !== "tie",
  );
  if (validLegs.length === 0) return null;
  let product = 1.0;
  for (const leg of validLegs) {
    const matchId = String(leg.matchId?._id || leg.matchId);
    const closingOdds = closingOddsByMatchId.get(matchId);
    const value = getOddValueFromOdds(
      closingOdds,
      leg.betCategoryId,
      leg.oddName,
    );
    if (value == null) return null;
    product *= value;
  }
  return product;
};

// A closing line this far (in implied probability) from the price the bettor
// actually took is not a line move — it is a bad odds record. Observed case:
// a Wimbledon match came through with Home/Away reversed (1.15/5.65 against a
// market of 6.00/1.13), which would hand the bettor a ~0.67 CLV swing on a data
// error. Real pre-match moves essentially never exceed this.
const MAX_CLV_DELTA = 0.3;

// Closing Line Value in implied-probability terms: clv = 1/close − 1/taken.
// Positive means the bettor took a better price than the market close.
// Returns null when the closing line is missing OR implausible, so a corrupt
// record scores as "no CLV" everywhere rather than as a huge fake edge.
const getBetClv = (bet, closingOddsByMatchId) => {
  const takenOdd = getOverallOddValue(bet);
  const closingOdd = getBetClosingOddValue(bet, closingOddsByMatchId);
  if (!(takenOdd > 1) || !(closingOdd > 1)) return null;
  const clv = 1 / closingOdd - 1 / takenOdd;
  if (Math.abs(clv) > MAX_CLV_DELTA) return null;
  return clv;
};

// ---------- Weekly contest scoring helpers ----------
// Monthly Contest points: Weekly Points = Base Points × Stake Mult × Count Mult

const BASE_POINTS_BY_RANK = {
  1: 100,
  2: 75,
  3: 50,
  4: 10,
  5: 8,
  6: 6,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
};
const BASE_POINTS_DEFAULT = 0;

const getStakeMultiplier = (stake) => {
  if (!Number.isFinite(stake)) return 0.7;
  if (stake > 2000) return 1.2;
  if (stake >= 1000) return 1.0;
  return 0.7;
};

const getCountMultiplier = (count) => {
  if (!Number.isFinite(count)) return 0.7;
  if (count > 20) return 1.2;
  if (count >= 10) return 1.0;
  return 0.7;
};

const getBasePointsForRank = (rank) => {
  if (rank == null) return 0;
  return BASE_POINTS_BY_RANK[rank] ?? BASE_POINTS_DEFAULT;
};

// ---------- Multi-axis weekly scoring (the monthly-contest currency) ----------
// Each week, every participant is scored on three axes, standardized within the
// week's cohort and weighted:
//   Action = ln(1 + Σ min(f, fcap)·u)      f=stake/startBal, u=4p(1-p), p=1/odd
//   Skill  = cellNorm(Σ f·CLV) · N/(N+N0)  CLV=1/close − 1/taken, debiased on
//                                          (probability band × lead-time bucket)
//   Profit = tanh(ROI / roiScale)          ROI=(end−start)/start, softcapped
//   survival = clamp(end/start, 0, 1)      fraction of bankroll preserved
//   upside   = wA·z(Action) + wK·z(Skill)  z() is winsorized and capped at ±zCap
//   discipline = −λ·max(0, maxBetFrac − 1) oversized staking, priced on behaviour
//   composite = (upside > 0 ? survival·upside : upside) + wP·z(Profit) + discipline
// Survival gate: Action and Skill are unbounded above and reward volume/CLV, but
// that credit is only real if the bankroll survives the week. The gate scales
// DOWN positive Action/Skill upside by the fraction of bankroll preserved, so a
// bust (end→0) keeps ~none of its manufactured action/CLV and collapses to the
// Profit axis — it can no longer top the week. Only positive upside is gated:
// surviving is never penalized, and a non-bettor (upside ≈ 0/negative) gets no
// free lift, so the gate fixes the bust exploit without rewarding inaction.
// Lead-time debiasing: CLV is not purely skill. Favourites shorten into the
// close, and the longer a bet is held the more of that drift it collects. Over
// June+July 2026 the field averaged +0.0034 CLV on bets placed inside an hour of
// start and +0.0116 on bets placed 8-16h out — the same bettors, the same edge,
// paid differently for betting early. Debiasing on (probability band × lead-time
// bucket) rather than band alone removes that, because lead time is orthogonal
// to price: band debiasing cannot see it.
// Buckets are deliberately coarse. A single week's CLV sample (125-320 bets)
// cannot support a fine 2-D baseline: with 6 buckets only ~45% of bets landed in
// a cell big enough to use, versus ~56% at 4. These four still separate the
// measured shape cleanly (June-July 2026 mean CLV by bucket: 0.0025 / 0.0074 /
// 0.0102 / 0.0015). Bets in a thin cell fall back to band-only debiasing, i.e.
// the previous behaviour — never worse, just not yet corrected.
const LEAD_TIME_EDGES = [0, 2, 8, 24]; // hours before first leg starts

const leadBucketOf = (hoursBeforeStart) => {
  if (hoursBeforeStart == null || !Number.isFinite(hoursBeforeStart))
    return "na";
  if (hoursBeforeStart < 0) return "inplay";
  for (let i = 0; i < LEAD_TIME_EDGES.length - 1; i++)
    if (hoursBeforeStart < LEAD_TIME_EDGES[i + 1]) return String(i);
  return String(LEAD_TIME_EDGES.length - 1);
};

// Hours between placing a bet and the earliest of its legs starting. A parlay is
// measured from its first leg, because that is when the bet stops being fully
// pre-match. Returns null when timing is unavailable, which sends the bet to the
// "na" bucket and lets it fall back to band-only debiasing.
// startByMatch: Map<matchId, Date|string>
const betLeadHours = (bet, startByMatch) => {
  if (!startByMatch || !bet.placedAt) return null;
  let earliest = null;
  for (const leg of bet.legs || []) {
    const start = startByMatch.get(String(leg.matchId?._id || leg.matchId));
    if (!start) continue;
    const t = new Date(start);
    if (Number.isNaN(t.getTime())) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  if (!earliest) return null;
  const hours = (earliest - new Date(bet.placedAt)) / 3600000;
  return Number.isFinite(hours) ? hours : null;
};

const SCORING_DEFAULTS = {
  wA: 1,
  wP: 1,
  wK: 1.5,
  N0: 40,
  fcap: 0.25,
  roiScale: 1.0,
  bandWidth: 0.1,
  survivalGate: true,
  // Debias CLV on (band × lead-time) when bet timing is available. Falls back to
  // band alone per-cell when a cell is too thin to give a stable baseline.
  leadDebias: true,
  leadMinCellN: 8,
  // Standardisation robustness. Tails are clipped to these quantiles before the
  // mean/sd are taken, so one windfall week cannot compress the whole field, and
  // no single axis may contribute more than zCap standard deviations.
  // (Median/MAD was tried and is unusable here: when most of the field shares an
  // identical value — e.g. zero skill — MAD collapses to ~0 and z-scores blow up.)
  winsorTail: 0.1,
  zCap: 2.5,
  // Staking discipline. min(f, fcap) caps what an oversized bet EARNS on Action
  // but never penalises it, and tanh() compresses ruin (losing everything scores
  // only 1.65x worse than losing half), so maximum variance was the rational
  // play. f > 1 is only reachable by compounding winnings mid-week — i.e. letting
  // it all ride — so that is the threshold. Linear above it, no cliff to sit on.
  disciplineThreshold: 1.0,
  disciplinePenalty: 0.5,
};

const softcapRoi = (roi, scale = SCORING_DEFAULTS.roiScale) =>
  Math.tanh(roi / scale);

const overallOdd = (bet) => {
  if (typeof bet.oddValue === "number" && bet.oddValue > 1) return bet.oddValue;
  try {
    const o = getOverallOddValue(bet);
    return Number.isFinite(o) && o > 1 ? o : null;
  } catch {
    return null;
  }
};

const quantile = (sortedAsc, q) => {
  if (sortedAsc.length === 0) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
};

// Standardize a field across the week's cohort. The centre and spread are taken
// from winsorized values (tails clipped to the winsorTail quantiles) so a single
// outlier week cannot compress everyone else's z-scores, and the resulting
// z is clamped to ±zCap so no one axis can dominate a week on its own.
const zscoreField = (rows, key, opts = {}) => {
  const o = { ...SCORING_DEFAULTS, ...opts };
  const vals = rows.map((r) => r[key]);
  if (vals.length === 0) return;

  let basis = vals;
  if (o.winsorTail > 0) {
    const sorted = [...vals].sort((a, b) => a - b);
    const lo = quantile(sorted, o.winsorTail);
    const hi = quantile(sorted, 1 - o.winsorTail);
    basis = vals.map((v) => Math.min(hi, Math.max(lo, v)));
  }

  const mean = basis.reduce((a, b) => a + b, 0) / basis.length;
  const sd =
    Math.sqrt(basis.reduce((a, b) => a + (b - mean) ** 2, 0) / basis.length) ||
    1;
  const cap = Number.isFinite(o.zCap) ? o.zCap : Infinity;
  for (const r of rows)
    r[`z_${key}`] = Math.max(-cap, Math.min(cap, (r[key] - mean) / sd));
};

// Score one week.
//   participants: [{ uid, name, startBal, endBal, bets:[{stake,oddValue,status,legs}] }]
//   closingByMatch: Map<matchId, oddsArray>
//   opts.startByMatch: Map<matchId, Date> — match start times, enabling
//     lead-time debiasing. Omit it and CLV falls back to band-only debiasing
//     (the pre-2026-08 behaviour), so existing callers keep working unchanged.
// Returns rows with axis values, z-scores, composite, and within-week weekRank.
const scoreWeek = (participants, closingByMatch, opts = {}) => {
  const o = { ...SCORING_DEFAULTS, ...opts };
  const bandKey = (p) => Math.min(9, Math.max(0, Math.floor(p / o.bandWidth)));

  const clvRecords = [];
  const rows = [];

  for (const p of participants) {
    const startBal = p.startBal || 1000;
    const realizedPnL = (p.endBal ?? 0) - startBal;
    let riskRaw = 0;
    let totalStake = 0;
    let stakeWeightedP = 0;
    let clvRaw = 0;
    let nClv = 0;
    let maxBetFrac = 0;

    for (const b of p.bets || []) {
      const stake = b.stake || 0;
      totalStake += stake;
      const odd = overallOdd(b);
      if (!odd) continue;
      const prob = 1 / odd;
      const f = stake / startBal;
      riskRaw += Math.min(f, o.fcap) * (4 * prob * (1 - prob));
      stakeWeightedP += stake * prob;
      maxBetFrac = Math.max(maxBetFrac, f);
      const clv = getBetClv(b, closingByMatch);
      if (clv != null) {
        clvRaw += f * clv;
        nClv += 1;
        clvRecords.push({
          uid: p.uid,
          w: f,
          clv,
          prob,
          lead: leadBucketOf(betLeadHours(b, o.startByMatch)),
        });
      }
    }

    const roi = realizedPnL / startBal;
    rows.push({
      uid: p.uid,
      name: p.name,
      startBal,
      endBal: p.endBal ?? 0,
      realizedPnL,
      roi,
      softRoi: softcapRoi(roi, o.roiScale),
      nBets: (p.bets || []).length,
      totalStake,
      stakeFracTotal: totalStake / startBal,
      avgP: totalStake > 0 ? stakeWeightedP / totalStake : 0,
      maxBetFrac,
      action: Math.log(1 + riskRaw),
      clvRaw,
      nClv,
    });
  }

  // Cohort CLV baselines. Primary key is (probability band × lead-time bucket)
  // so a bettor is only credited for beating the close by more than others who
  // took a similar price AT A SIMILAR TIME. Thin cells fall back to the band
  // average, which is the previous behaviour.
  const cellSum = {};
  const cellCount = {};
  const bandSum = {};
  const bandCount = {};
  for (const r of clvRecords) {
    const b = bandKey(r.prob);
    const c = `${b}|${r.lead}`;
    cellSum[c] = (cellSum[c] || 0) + r.clv;
    cellCount[c] = (cellCount[c] || 0) + 1;
    bandSum[b] = (bandSum[b] || 0) + r.clv;
    bandCount[b] = (bandCount[b] || 0) + 1;
  }
  const baselineFor = (rec) => {
    const b = bandKey(rec.prob);
    if (o.leadDebias) {
      const c = `${b}|${rec.lead}`;
      if (cellCount[c] >= o.leadMinCellN) return cellSum[c] / cellCount[c];
    }
    return bandCount[b] ? bandSum[b] / bandCount[b] : 0;
  };

  const normByUid = {};
  for (const r of clvRecords) {
    normByUid[r.uid] = (normByUid[r.uid] || 0) + r.w * (r.clv - baselineFor(r));
  }
  for (const r of rows)
    r.skill = (normByUid[r.uid] || 0) * (r.nClv / (r.nClv + o.N0));

  zscoreField(rows, "action", o);
  zscoreField(rows, "softRoi", o);
  zscoreField(rows, "skill", o);
  for (const r of rows) {
    const upside = o.wA * r.z_action + o.wK * r.z_skill;
    // Fraction of bankroll preserved (1 = ended flat-or-up, 0 = busted out).
    r.survival = o.survivalGate
      ? Math.max(0, Math.min(1, (r.endBal ?? 0) / (r.startBal || 1000)))
      : 1;
    // Gate positive upside only: busting strips manufactured action/CLV credit,
    // surviving is never penalized, and a non-bettor gets no lift toward zero.
    const gatedUpside = upside > 0 ? r.survival * upside : upside;
    // Staking discipline. The survival gate is outcome-conditional — it only
    // punishes recklessness that FAILED, so a 3.3x-bankroll swing that happened
    // to win pays nothing. This term is behaviour-conditional: it prices the
    // risk taken regardless of how the coin landed.
    r.discipline =
      -o.disciplinePenalty *
      Math.max(0, r.maxBetFrac - o.disciplineThreshold);
    r.composite = gatedUpside + o.wP * r.z_softRoi + r.discipline;
  }

  const byComp = [...rows].sort((a, b) => b.composite - a.composite);
  byComp.forEach((r, i) => (r.weekRank = i + 1));
  return rows;
};

module.exports = {
  getOverallOddValue,
  getBetResult,
  getOddValueFromOdds,
  getBetClosingOddValue,
  getBetClv,
  BASE_POINTS_BY_RANK,
  BASE_POINTS_DEFAULT,
  getStakeMultiplier,
  getCountMultiplier,
  getBasePointsForRank,
  SCORING_DEFAULTS,
  softcapRoi,
  overallOdd,
  zscoreField,
  scoreWeek,
  MAX_CLV_DELTA,
  LEAD_TIME_EDGES,
  leadBucketOf,
  betLeadHours,
};
