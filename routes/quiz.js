// routes/quiz.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const { generateQuizQuestions, evaluateReverse, evaluateTeaching } = require('../services/anthropic');
const { computeQuizXP, levelFromXP, titleForLevel, xpForLevel, adaptDifficulty } = require('../utils/xp');

const router = express.Router();

// Fallback question banks per topic
const FALLBACK_QUESTIONS = {
  'Data Structures': [
    { q: 'What is O(log n) complexity?', options: ['A) Linear growth', 'B) Problem halves each step', 'C) Constant time', 'D) Quadratic growth'], answer: 1, concept: 'Time complexity', error_type: 'Algorithm analysis', thinking_path: ['Recall Big-O basics', 'Think about how problem size changes each iteration', 'log n means dividing by 2 each time — like binary search'] },
    { q: 'Best algorithm for searching a sorted array?', options: ['A) Linear Search O(n)', 'B) Binary Search O(log n)', 'C) Hashing O(1)', 'D) DFS O(V+E)'], answer: 1, concept: 'Searching algorithms', error_type: 'Algorithm selection', thinking_path: ['Note the array is sorted — key clue', 'Sorted data → binary search applies', 'O(log n) is optimal for sorted arrays'] },
    { q: 'What is the base case in recursion?', options: ['A) The recursive call', 'B) The return statement', 'C) Condition that stops recursion', 'D) The function signature'], answer: 2, concept: 'Recursion', error_type: 'Conceptual gap', thinking_path: ['Recursion = function calling itself', 'Without stop condition → infinite loop', 'Base case = termination condition'] },
    { q: 'Which data structure uses LIFO?', options: ['A) Queue', 'B) Stack', 'C) Linked List', 'D) Binary Tree'], answer: 1, concept: 'Stack', error_type: 'Data structure confusion', thinking_path: ['LIFO = Last In First Out', 'Think of a stack of plates', 'Stack → LIFO. Queue → FIFO'] },
    { q: 'Big-O of accessing array element by index?', options: ['A) O(n)', 'B) O(log n)', 'C) O(1)', 'D) O(n²)'], answer: 2, concept: 'Array access', error_type: 'Complexity analysis', thinking_path: ['Arrays store elements in contiguous memory', 'Index maps directly to memory address', 'Direct access → constant time O(1)'] },
  ],
  default: [
    { q: 'What does CPU stand for?', options: ['A) Central Processing Unit', 'B) Core Processor Unit', 'C) Computer Power Unit', 'D) Central Power Unit'], answer: 0, concept: 'Computer basics', error_type: 'Terminology', thinking_path: ['CPU is the brain of the computer', 'It performs all computations', 'Central Processing Unit'] },
    { q: 'What is RAM?', options: ['A) Read-only Memory', 'B) Random Access Memory', 'C) Rapid Application Management', 'D) Redundant Array Memory'], answer: 1, concept: 'Memory', error_type: 'Acronym confusion', thinking_path: ['RAM is temporary storage', 'It is fast and volatile', 'Random Access Memory'] },
  ]
};

/**
 * POST /api/quiz/generate
 * Body: { topic, difficulty, count = 5, mode = 'quiz' }
 */
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { topic, difficulty = 'medium', count = 5, mode = 'quiz' } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    let questions;
    try {
      questions = await generateQuizQuestions({ topic, difficulty, count });
    } catch (err) {
      console.warn('AI generation failed, using fallback:', err.message);
      questions = (FALLBACK_QUESTIONS[topic] || FALLBACK_QUESTIONS.default).slice(0, count);
    }

    res.json({ questions, topic, difficulty, mode, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Quiz generate error:', err);
    res.status(500).json({ error: 'Failed to generate quiz' });
  }
});

/**
 * POST /api/quiz/submit
 * Body: { topic, difficulty, mode, score, total, timeTaken, attempts: [{concept, isCorrect, timeTaken, difficulty}] }
 */
router.post('/submit', authMiddleware, (req, res) => {
  try {
    const { topic, difficulty, mode = 'quiz', score, total, timeTaken, attempts = [] } = req.body;
    const { userId } = req.user;
    const db = getDB();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);

    const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;
    const xpEarned = computeQuizXP({ score, total, difficulty, timeTaken, streak: user.streak });

    // Create session
    const sessionId = uuidv4();
    db.prepare(`
      INSERT INTO quiz_sessions (id, user_id, topic, difficulty, score, total, accuracy, xp_earned, time_taken, mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, userId, topic, difficulty, score, total, accuracy, xpEarned, timeTaken, mode);

    // Save attempts
    const insertAttempt = db.prepare(`
      INSERT INTO question_attempts (id, session_id, user_id, topic, concept, is_correct, time_taken, difficulty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of attempts) {
      insertAttempt.run(uuidv4(), sessionId, userId, topic, a.concept || topic, a.isCorrect ? 1 : 0, a.timeTaken, difficulty);
    }

    // Update XP and level
    const newXP = user.xp + xpEarned;
    const newLevel = levelFromXP(newXP);
    const newTitle = titleForLevel(newLevel);
    const newXPToNext = xpForLevel(newLevel);
    const leveledUp = newLevel > user.level;

    db.prepare(`
      UPDATE users SET xp = ?, level = ?, title = ?, xp_to_next = ? WHERE id = ?
    `).run(newXP, newLevel, newTitle, newXPToNext, userId);

    // Update user stats
    const prevTotal = stats?.total_quizzes || 0;
    const prevAvg = stats?.avg_accuracy || 0;
    const newTotal = prevTotal + 1;
    const newAvg = (prevAvg * prevTotal + accuracy) / newTotal;

    db.prepare(`
      INSERT INTO user_stats (user_id, total_quizzes, avg_accuracy, total_xp_earned)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        total_quizzes = total_quizzes + 1,
        avg_accuracy = ?,
        total_xp_earned = total_xp_earned + ?,
        updated_at = datetime('now')
    `).run(userId, 1, accuracy, xpEarned, newAvg, xpEarned);

    // Update skill mastery
    upsertSkillProgress(db, userId, topic, score, total, xpEarned);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (id, user_id, activity_type, description, xp_earned, icon)
      VALUES (?, ?, 'quiz', ?, ?, '📚')
    `).run(uuidv4(), userId, `${topic} Quiz — ${score}/${total}`, xpEarned);

    // Check and award badges
    const newBadges = checkBadges(db, userId, { accuracy, score, total, difficulty, timeTaken, mode });

    // Check quest completion
    const today = new Date().toISOString().split('T')[0];
    const quizQuest = db.prepare(`SELECT * FROM daily_quests WHERE user_id = ? AND quest_date = ? AND quest_type = 'quiz' AND is_complete = 0`).get(userId, today);
    if (quizQuest) {
      const sessionCount = db.prepare(`SELECT COUNT(*) as cnt FROM quiz_sessions WHERE user_id = ? AND date(created_at) = date('now')`).get(userId)?.cnt || 0;
      if (sessionCount >= 3) {
        db.prepare(`UPDATE daily_quests SET is_complete = 1 WHERE id = ?`).run(quizQuest.id);
      }
    }

    res.json({
      sessionId,
      xpEarned,
      accuracy,
      newXP,
      newLevel,
      newTitle,
      leveledUp,
      newBadges
    });
  } catch (err) {
    console.error('Quiz submit error:', err);
    res.status(500).json({ error: 'Failed to submit quiz' });
  }
});

/**
 * POST /api/quiz/adapt
 * Body: { history: [{correct, time}], currentDifficulty }
 */
router.post('/adapt', authMiddleware, (req, res) => {
  const { history, currentDifficulty } = req.body;
  const result = adaptDifficulty(history || [], currentDifficulty || 'medium');
  res.json(result);
});

/**
 * GET /api/quiz/history
 */
router.get('/history', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const limit = parseInt(req.query.limit) || 10;
    const topic = req.query.topic;

    let query = 'SELECT * FROM quiz_sessions WHERE user_id = ?';
    const params = [req.user.userId];
    if (topic) { query += ' AND topic = ?'; params.push(topic); }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const sessions = db.prepare(query).all(...params);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * POST /api/quiz/reverse/evaluate
 * Body: { code, expectedOutput }
 */
router.post('/reverse/evaluate', authMiddleware, async (req, res) => {
  try {
    const { code, expectedOutput } = req.body;
    if (!code || !expectedOutput) return res.status(400).json({ error: 'code and expectedOutput required' });

    let feedback;
    try {
      feedback = await evaluateReverse({ code, expectedOutput });
    } catch {
      feedback = `On the right track! Key insight: match the given output pattern carefully. Try a simple loop or formula.`;
    }

    // Log activity
    const db = getDB();
    db.prepare(`
      INSERT INTO activity_log (id, user_id, activity_type, description, xp_earned, icon)
      VALUES (?, ?, 'reverse', 'Reverse Mode attempt', 20, '🔄')
    `).run(uuidv4(), req.user.userId);

    db.prepare(`
      INSERT INTO user_stats (user_id, total_xp_earned) VALUES (?, 20)
      ON CONFLICT(user_id) DO UPDATE SET total_xp_earned = total_xp_earned + 20, updated_at = datetime('now')
    `).run(req.user.userId);

    db.prepare(`UPDATE users SET xp = xp + 20 WHERE id = ?`).run(req.user.userId);

    res.json({ feedback, xpEarned: 20 });
  } catch (err) {
    res.status(500).json({ error: 'Evaluation failed' });
  }
});

/**
 * POST /api/quiz/teach/evaluate
 * Body: { explanation, concept }
 */
router.post('/teach/evaluate', authMiddleware, async (req, res) => {
  try {
    const { explanation, concept } = req.body;
    if (!explanation || !concept) return res.status(400).json({ error: 'explanation and concept required' });

    let feedback;
    try {
      feedback = await evaluateTeaching({ explanation, concept });
    } catch {
      feedback = `Great effort! Tip: Add a concrete example. Your explanation shows understanding of the basics. Score: 7/10.`;
    }

    const db = getDB();
    db.prepare(`INSERT INTO activity_log (id, user_id, activity_type, description, xp_earned, icon) VALUES (?, ?, 'teach', ?, 40, '📖')`).run(uuidv4(), req.user.userId, `Taught: ${concept}`);
    db.prepare(`UPDATE users SET xp = xp + 40 WHERE id = ?`).run(req.user.userId);

    // Check teach quest
    const today = new Date().toISOString().split('T')[0];
    db.prepare(`UPDATE daily_quests SET is_complete = 1 WHERE user_id = ? AND quest_date = ? AND quest_type = 'teach' AND is_complete = 0`).run(req.user.userId, today);

    res.json({ feedback, xpEarned: 40 });
  } catch (err) {
    res.status(500).json({ error: 'Evaluation failed' });
  }
});

/**
 * GET /api/quiz/mistakes
 * Returns mistake intelligence — top weak concepts
 */
router.get('/mistakes', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const rows = db.prepare(`
      SELECT concept, topic,
             COUNT(*) as total,
             SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as wrong,
             ROUND(100.0 * SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as accuracy
      FROM question_attempts
      WHERE user_id = ? AND created_at >= date('now', '-30 days')
      GROUP BY concept, topic
      HAVING total >= 2
      ORDER BY accuracy ASC
      LIMIT 10
    `).all(req.user.userId);

    res.json({ weakConcepts: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch mistakes' });
  }
});

// --- Helpers ---

function upsertSkillProgress(db, userId, topic, score, total, xpEarned) {
  const existing = db.prepare('SELECT * FROM skill_progress WHERE user_id = ? AND topic = ?').get(userId, topic);
  if (!existing) {
    db.prepare(`
      INSERT INTO skill_progress (user_id, topic, mastery_pct, xp_earned, quizzes_done, last_studied)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `).run(userId, topic, Math.round((score / total) * 100), xpEarned);
  } else {
    // Weighted average toward new score
    const sessions = existing.quizzes_done + 1;
    const newPct = ((existing.mastery_pct * existing.quizzes_done) + (score / total * 100)) / sessions;
    db.prepare(`
      UPDATE skill_progress SET mastery_pct = ?, xp_earned = xp_earned + ?, quizzes_done = ?, last_studied = datetime('now')
      WHERE user_id = ? AND topic = ?
    `).run(Math.round(newPct), xpEarned, sessions, userId, topic);
  }
}

function checkBadges(db, userId, { accuracy, score, total, difficulty, timeTaken, mode }) {
  const earned = [];
  const stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  const awardBadge = (badgeId) => {
    const has = db.prepare('SELECT badge_id FROM user_badges WHERE user_id = ? AND badge_id = ?').get(userId, badgeId);
    if (!has) {
      db.prepare('INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?)').run(userId, badgeId);
      earned.push(badgeId);
    }
  };

  if (user?.streak >= 7) awardBadge('streak_master');
  if (timeTaken < 60) awardBadge('speed_demon');
  if (accuracy >= 90) awardBadge('sharpshooter');
  if ((stats?.total_quizzes || 0) >= 10) awardBadge('brain_power');
  if ((stats?.battle_wins || 0) >= 10) awardBadge('battle_winner');
  if (mode === 'teach') awardBadge('teacher');
  if (score === total && difficulty === 'hard') awardBadge('perfect_score');

  return earned;
}

module.exports = router;
