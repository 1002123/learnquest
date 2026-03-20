// routes/users.js
const express = require('express');
const { getDB } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const { levelFromXP, titleForLevel, xpForLevel } = require('../utils/xp');

const router = express.Router();

/**
 * GET /api/users/me
 * Returns full profile with stats, badges, skill progress
 */
router.get('/me', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.user;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
    const skills = db.prepare('SELECT * FROM skill_progress WHERE user_id = ?').all(userId);
    const badges = db.prepare(`
      SELECT b.*, ub.earned_at FROM user_badges ub
      JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = ?
    `).all(userId);
    const allBadges = db.prepare('SELECT * FROM badges').all();
    const quests = db.prepare(`
      SELECT * FROM daily_quests 
      WHERE user_id = ? AND quest_date = date('now')
      ORDER BY created_at
    `).all(userId);

    res.json({
      user: formatUser(user),
      stats: stats || {},
      skills: skills.reduce((acc, s) => {
        acc[s.topic] = { mastery: s.mastery_pct, xp: s.xp_earned, quizzes: s.quizzes_done, lastStudied: s.last_studied };
        return acc;
      }, {}),
      badges: {
        earned: badges.map(b => b.id),
        all: allBadges
      },
      dailyQuests: quests
    });
  } catch (err) {
    console.error('GET /me error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * GET /api/users/heatmap
 * Returns 91-day activity data for heatmap
 */
router.get('/heatmap', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.user;

    const rows = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM activity_log
      WHERE user_id = ? AND created_at >= date('now', '-91 days')
      GROUP BY day
    `).all(userId);

    const map = {};
    for (const r of rows) map[r.day] = r.count;

    // Build 91-day array
    const cells = [];
    for (let i = 90; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const count = map[key] || 0;
      const level = count === 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4;
      cells.push({ date: key, count, level });
    }

    res.json({ cells });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch heatmap' });
  }
});

/**
 * GET /api/users/activity
 * Recent activity feed (last 20 entries)
 */
router.get('/activity', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.user;
    const limit = parseInt(req.query.limit) || 20;

    const rows = db.prepare(`
      SELECT * FROM activity_log 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(userId, limit);

    res.json({ activity: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

/**
 * GET /api/users/portfolio
 */
router.get('/portfolio', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const items = db.prepare('SELECT * FROM portfolio_items WHERE user_id = ? ORDER BY created_at DESC').all(req.user.userId);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

/**
 * POST /api/users/portfolio
 */
router.post('/portfolio', authMiddleware, (req, res) => {
  try {
    const { v4: uuidv4 } = require('uuid');
    const db = getDB();
    const { title, description, difficulty, tags } = req.body;
    const id = uuidv4();
    const shareLink = `https://learnquest.app/portfolio/${id}`;

    db.prepare(`
      INSERT INTO portfolio_items (id, user_id, title, description, difficulty, tags, share_link)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.userId, title, description, difficulty, JSON.stringify(tags || []), shareLink);

    res.status(201).json({ id, shareLink });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add portfolio item' });
  }
});

/**
 * GET /api/users/predictions
 * AI-powered progress predictions
 */
router.get('/predictions', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.user;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
    const skills = db.prepare('SELECT * FROM skill_progress WHERE user_id = ?').all(userId);

    // Count quizzes this week
    const weeklyQuizzes = db.prepare(`
      SELECT COUNT(*) as cnt FROM quiz_sessions 
      WHERE user_id = ? AND created_at >= date('now', '-7 days')
    `).get(userId)?.cnt || 0;

    const skillMap = skills.reduce((a, s) => { a[s.topic] = s.mastery_pct; return a; }, {});

    const { generatePredictions } = require('../services/anthropic');
    const predictions = await generatePredictions({
      userContext: {
        level: user.level,
        xp: user.xp,
        avgAccuracy: stats?.avg_accuracy || 0,
        streak: user.streak,
        quizzesPerWeek: weeklyQuizzes,
        skills: {
          dsa: skillMap['Data Structures'] || 0,
          networks: skillMap['Computer Networks'] || 0,
          db: skillMap['Database Systems'] || 0
        }
      }
    });

    res.json({ predictions });
  } catch (err) {
    console.error('Predictions error:', err);
    // Fallback predictions
    res.json({
      predictions: {
        masterDSA: '21 days',
        reachLevel15: '30 days',
        top3Leaderboard: '45 days',
        placementReady: '90 days',
        insight: 'Focus on daily consistency — even 15 min/day compounds massively over 90 days.'
      }
    });
  }
});

function formatUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.display_name,
    avatarInitials: u.avatar_initials,
    level: u.level,
    xp: u.xp,
    xpToNext: u.xp_to_next,
    streak: u.streak,
    elo: u.elo,
    title: u.title,
    createdAt: u.created_at
  };
}

module.exports = router;
