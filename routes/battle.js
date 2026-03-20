// routes/battle.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const { computeEloChange, computeBattleXP } = require('../utils/xp');

const router = express.Router();

// Battle question pool
const BATTLE_QUESTIONS = [
  { q: 'What is O(n log n)?', opts: ['Constant', 'Linear', 'Merge Sort avg', 'Quadratic'], ans: 2 },
  { q: 'Which data structure uses FIFO?', opts: ['Stack', 'Queue', 'Tree', 'Graph'], ans: 1 },
  { q: 'What is a hash collision?', opts: ['Memory error', 'Two keys → same bucket', 'Null pointer', 'Stack overflow'], ans: 1 },
  { q: 'Binary search requires array to be?', opts: ['Unsorted', 'Sorted', 'Random', 'Circular'], ans: 1 },
  { q: 'DFS uses which structure internally?', opts: ['Queue', 'Heap', 'Stack', 'Array'], ans: 2 },
  { q: 'Which is NOT a stable sort?', opts: ['Merge Sort', 'Bubble Sort', 'Quick Sort', 'Insertion Sort'], ans: 2 },
  { q: 'What does TCP stand for?', opts: ['Transfer Control Protocol', 'Transmission Control Protocol', 'Transport Communication Protocol', 'Transfer Communication Protocol'], ans: 1 },
  { q: 'Primary key in a database must be?', opts: ['Null', 'Unique and Not Null', 'Auto-increment', 'A number'], ans: 1 },
  { q: 'What is the default port for HTTPS?', opts: ['80', '8080', '443', '22'], ans: 2 },
  { q: 'In SQL, SELECT DISTINCT returns?', opts: ['All rows', 'Unique rows only', 'Random rows', 'Sorted rows'], ans: 1 },
  { q: 'A deadlock in OS occurs when?', opts: ['CPU is overloaded', 'Processes wait for each other forever', 'Memory is full', 'Disk fails'], ans: 1 },
  { q: 'Which layer handles IP addressing in OSI?', opts: ['Physical', 'Data Link', 'Network', 'Transport'], ans: 2 },
  { q: 'Which traversal visits root first?', opts: ['Inorder', 'Postorder', 'Preorder', 'Level order'], ans: 2 },
  { q: 'Time complexity of Dijkstra with min-heap?', opts: ['O(V²)', 'O(V log V + E)', 'O(E log V)', 'O(V + E log E)'], ans: 2 },
  { q: 'Which SQL command removes a table?', opts: ['DELETE', 'TRUNCATE', 'DROP', 'REMOVE'], ans: 2 },
];

// Bot opponents for matchmaking
const BOT_OPPONENTS = [
  { name: 'Rahul P.', elo: 1210, initials: 'R', gradient: 'linear-gradient(135deg,#f43f5e,#f59e0b)' },
  { name: 'Priya S.', elo: 1270, initials: 'P', gradient: 'linear-gradient(135deg,#8b5cf6,#ec4899)' },
  { name: 'Tom W.', elo: 1195, initials: 'T', gradient: 'linear-gradient(135deg,#06b6d4,#10b981)' },
];

/**
 * GET /api/battle/opponents
 * Returns matchmade opponents near the user's Elo
 */
router.get('/opponents', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const user = db.prepare('SELECT elo FROM users WHERE id = ?').get(req.user.userId);
    const userElo = user?.elo || 1000;

    // In production: find real users near Elo. For now: bots + nearby users
    const realOpponents = db.prepare(`
      SELECT id, display_name as name, avatar_initials as initials, elo, level
      FROM users
      WHERE id != ?
        AND ABS(elo - ?) <= 200
      ORDER BY ABS(elo - ?) ASC
      LIMIT 5
    `).all(req.user.userId, userElo, userElo);

    const opponents = [
      ...realOpponents.map(u => ({ ...u, isBot: false })),
      ...BOT_OPPONENTS.map(b => ({ ...b, isBot: true }))
    ].slice(0, 5);

    res.json({ opponents, yourElo: userElo });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch opponents' });
  }
});

/**
 * POST /api/battle/start
 * Body: { opponentId?, opponentName, opponentElo, isBot = true, topic? }
 */
router.post('/start', authMiddleware, (req, res) => {
  try {
    const { opponentId, opponentName, opponentElo = 1000, isBot = true, topic } = req.body;
    const db = getDB();
    const { userId } = req.user;

    // Pick random questions for this battle
    const shuffled = BATTLE_QUESTIONS
      .slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, 5);

    const battleId = uuidv4();
    db.prepare(`
      INSERT INTO battles (id, challenger_id, opponent_id, opponent_name, opponent_elo, is_bot, topic, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(battleId, userId, opponentId || null, opponentName, opponentElo, isBot ? 1 : 0, topic || 'Mixed');

    res.json({
      battleId,
      questions: shuffled,
      opponent: { name: opponentName, elo: opponentElo, isBot }
    });
  } catch (err) {
    console.error('Battle start error:', err);
    res.status(500).json({ error: 'Failed to start battle' });
  }
});

/**
 * POST /api/battle/result
 * Body: { battleId, myScore, opponentScore }
 */
router.post('/result', authMiddleware, (req, res) => {
  try {
    const { battleId, myScore, opponentScore } = req.body;
    const db = getDB();
    const { userId } = req.user;

    const battle = db.prepare('SELECT * FROM battles WHERE id = ? AND challenger_id = ?').get(battleId, userId);
    if (!battle) return res.status(404).json({ error: 'Battle not found' });
    if (battle.status === 'complete') return res.status(400).json({ error: 'Battle already completed' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const won = myScore > opponentScore;

    const eloChange = computeEloChange(user.elo, battle.opponent_elo, won);
    const newElo = Math.max(100, user.elo + eloChange);
    const xpEarned = computeBattleXP({ won, eloChange });

    // Update battle
    db.prepare(`
      UPDATE battles SET
        challenger_score = ?,
        opponent_score = ?,
        winner_id = ?,
        elo_change = ?,
        status = 'complete',
        completed_at = datetime('now')
      WHERE id = ?
    `).run(myScore, opponentScore, won ? userId : null, eloChange, battleId);

    // Update user
    db.prepare(`UPDATE users SET elo = ?, xp = xp + ? WHERE id = ?`).run(newElo, xpEarned, userId);

    // Update stats
    if (won) {
      db.prepare(`
        INSERT INTO user_stats (user_id, battle_wins, total_xp_earned) VALUES (?, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET battle_wins = battle_wins + 1, total_xp_earned = total_xp_earned + ?, updated_at = datetime('now')
      `).run(userId, xpEarned, xpEarned);
    } else {
      db.prepare(`
        INSERT INTO user_stats (user_id, battle_losses) VALUES (?, 1)
        ON CONFLICT(user_id) DO UPDATE SET battle_losses = battle_losses + 1, updated_at = datetime('now')
      `).run(userId);
    }

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (id, user_id, activity_type, description, xp_earned, icon)
      VALUES (?, ?, 'battle', ?, ?, '⚔️')
    `).run(uuidv4(), userId, won ? `Won Battle vs ${battle.opponent_name}` : `Lost Battle vs ${battle.opponent_name}`, xpEarned);

    // Complete quest
    if (won) {
      const today = new Date().toISOString().split('T')[0];
      db.prepare(`UPDATE daily_quests SET is_complete = 1 WHERE user_id = ? AND quest_date = ? AND quest_type = 'battle' AND is_complete = 0`).run(userId, today);
    }

    res.json({
      won,
      eloChange,
      newElo,
      xpEarned,
      result: `${myScore}-${opponentScore}`
    });
  } catch (err) {
    console.error('Battle result error:', err);
    res.status(500).json({ error: 'Failed to submit battle result' });
  }
});

/**
 * GET /api/battle/history
 */
router.get('/history', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const battles = db.prepare(`
      SELECT * FROM battles
      WHERE challenger_id = ? AND status = 'complete'
      ORDER BY completed_at DESC LIMIT 20
    `).all(req.user.userId);
    res.json({ battles });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch battle history' });
  }
});

/**
 * GET /api/battle/questions
 * Returns 5 random battle questions
 */
router.get('/questions', authMiddleware, (req, res) => {
  const questions = BATTLE_QUESTIONS
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, 5);
  res.json({ questions });
});

module.exports = router;
