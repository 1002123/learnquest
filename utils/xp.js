// utils/xp.js

// Level titles
const LEVEL_TITLES = [
  'Newcomer', 'Beginner', 'Learner', 'Explorer', 'Student',
  'Apprentice', 'Practitioner', 'Intermediate', 'Advanced', 'Skilled',
  'Scholar', 'Expert', 'Master', 'Senior', 'Elite',
  'Champion', 'Legend', 'Grand Master', 'Sage', 'Diamond Mind'
];

/**
 * XP required to reach a given level.
 * Scales: 500 * level^1.4
 */
function xpForLevel(level) {
  return Math.floor(500 * Math.pow(level, 1.4));
}

/**
 * Get level from total XP.
 */
function levelFromXP(totalXP) {
  let level = 1;
  let accumulated = 0;
  while (true) {
    const needed = xpForLevel(level);
    if (accumulated + needed > totalXP) break;
    accumulated += needed;
    level++;
    if (level >= 20) { level = 20; break; }
  }
  return level;
}

function titleForLevel(level) {
  return LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)];
}

/**
 * Compute XP reward for a quiz result.
 */
function computeQuizXP({ score, total, difficulty, timeTaken, streak }) {
  const diffMultiplier = { easy: 20, medium: 30, hard: 40 }[difficulty] || 25;
  let xp = score * diffMultiplier;

  // Perfect score bonus
  if (score === total) xp += 50;

  // Speed bonus: < 90s total
  if (timeTaken < 90) xp += 20;

  // Streak multiplier (max 1.5x at streak 30+)
  const streakMult = Math.min(1 + Math.floor(streak / 10) * 0.1, 1.5);
  xp = Math.floor(xp * streakMult);

  return xp;
}

/**
 * Compute XP for battle.
 */
function computeBattleXP({ won, eloChange }) {
  return won ? 80 + Math.max(0, eloChange) : 15;
}

/**
 * Elo calculation.
 */
function computeEloChange(playerElo, opponentElo, won) {
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  const actual = won ? 1 : 0;
  return Math.round(K * (actual - expected));
}

/**
 * Adaptive difficulty engine.
 * history: array of { correct: bool, time: number (seconds) }
 * Returns: { newDifficulty, message | null }
 */
function adaptDifficulty(history, currentDifficulty) {
  const levels = ['easy', 'medium', 'hard'];
  let idx = levels.indexOf(currentDifficulty);
  if (idx === -1) idx = 1;

  const recent = history.slice(-3);
  if (recent.length < 2) return { newDifficulty: currentDifficulty, message: null };

  const accuracy = recent.filter(h => h.correct).length / recent.length;
  const avgTime = recent.reduce((a, b) => a + b.time, 0) / recent.length;

  if (accuracy > 0.8 && avgTime < 15 && idx < 2) {
    idx++;
    return { newDifficulty: levels[idx], message: `⬆ Difficulty → ${levels[idx]}! You're crushing it.` };
  }
  if (accuracy < 0.5 && idx > 0) {
    idx--;
    return { newDifficulty: levels[idx], message: `⬇ Difficulty → ${levels[idx]}. Adjusting for your flow state.` };
  }

  return { newDifficulty: currentDifficulty, message: null };
}

module.exports = {
  xpForLevel,
  levelFromXP,
  titleForLevel,
  computeQuizXP,
  computeBattleXP,
  computeEloChange,
  adaptDifficulty
};
