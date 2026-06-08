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

  const hasLost = validLegs.some((leg) => leg.status === "lost");
  if (hasLost) return "lost";

  const hasWon = validLegs.every((leg) => leg.status === "won");
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

// Closing Line Value in implied-probability terms: clv = 1/close − 1/taken.
// Positive means the bettor took a better price than the market close.
const getBetClv = (bet, closingOddsByMatchId) => {
  const takenOdd = getOverallOddValue(bet);
  const closingOdd = getBetClosingOddValue(bet, closingOddsByMatchId);
  if (!(takenOdd > 1) || !(closingOdd > 1)) return null;
  return 1 / closingOdd - 1 / takenOdd;
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
//   Skill  = bandNorm(Σ f·CLV) · N/(N+N0)  CLV=1/close − 1/taken (band-debiased)
//   Profit = tanh(ROI / roiScale)          ROI=(end−start)/start, softcapped
//   composite = wA·z(Action) + wP·z(Profit) + wK·z(Skill)
const SCORING_DEFAULTS = {
  wA: 1,
  wP: 1,
  wK: 1.5,
  N0: 40,
  fcap: 0.25,
  roiScale: 1.0,
  bandWidth: 0.1,
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

const zscoreField = (rows, key) => {
  const vals = rows.map((r) => r[key]);
  const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const sd =
    Math.sqrt(
      vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1),
    ) || 1;
  for (const r of rows) r[`z_${key}`] = (r[key] - mean) / sd;
};

// Score one week.
//   participants: [{ uid, name, startBal, endBal, bets:[{stake,oddValue,status,legs}] }]
//   closingByMatch: Map<matchId, oddsArray>
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
        clvRecords.push({ uid: p.uid, w: f, clv, prob });
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

  const bandSum = {};
  const bandCount = {};
  for (const r of clvRecords) {
    const k = bandKey(r.prob);
    bandSum[k] = (bandSum[k] || 0) + r.clv;
    bandCount[k] = (bandCount[k] || 0) + 1;
  }
  const baseline = {};
  for (const k of Object.keys(bandCount)) baseline[k] = bandSum[k] / bandCount[k];
  const normByUid = {};
  for (const r of clvRecords) {
    const base = baseline[bandKey(r.prob)] || 0;
    normByUid[r.uid] = (normByUid[r.uid] || 0) + r.w * (r.clv - base);
  }
  for (const r of rows)
    r.skill = (normByUid[r.uid] || 0) * (r.nClv / (r.nClv + o.N0));

  zscoreField(rows, "action");
  zscoreField(rows, "softRoi");
  zscoreField(rows, "skill");
  for (const r of rows)
    r.composite = o.wA * r.z_action + o.wP * r.z_softRoi + o.wK * r.z_skill;

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
};
