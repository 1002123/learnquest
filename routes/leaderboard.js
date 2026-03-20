// routes/leaderboard.js
const express = require('express');
const { getDB } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/leaderboard
 * Query: type = 'weekly' | 'monthly' | 'alltime' | 'battle'
 * Query: limit = number (default 20)
 */
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.user;
    const type = req.query.type || 'weekly';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let entries;

    if (type === 'battle') {
      entries = db.prepare(`
        SELECT u.id, u.display_name as name, u.avatar_initials as initials,
               u.level, u.title, u.elo as score,
               us.battle_wins, us.battle_losses,
               COALESCE(u.streak, 0) as streak,
               ROW_NUMBER() OVER (ORDER BY u.elo DESC) as rank
        FROM users u
        LEFT JOIN user_stats us ON us.user_id = u.id
        ORDER BY u.elo DESC
        LIMIT ?
      `).all(limit);
    } else {
      let dateFilter = '';
      if (type === 'weekly') dateFilter = `AND qs.created_at >= date('now', '-7 days')`;
      else if (type === 'monthly') dateFilter = `AND qs.created_at >= date('now', '-30 days')`;

      if (type === 'alltime') {
        entries = db.prepare(`
          SELECT u.id, u.display_name as name, u.avatar_initials as initials,
                 u.level, u.title,
                 COALESCE(us.total_xp_earned, u.xp) as score,
                 COALESCE(u.streak, 0) as streak,
                 ROW_NUMBER() OVER (ORDER BY u.xp DESC) as rank
          FROM users u
          LEFT JOIN user_stats us ON us.user_id = u.id
          ORDER BY u.xp DESC
          LIMIT ?
        `).all(limit);
      } else {
        entries = db.prepare(`
          SELECT u.id, u.display_name as name, u.avatar_initials as initials,
                 u.level, u.title,
                 COALESCE(SUM(qs.xp_earned), 0) as score,
                 COALESCE(u.streak, 0) as streak,
                 ROW_NUMBER() OVER (ORDER BY SUM(qs.xp_earned) DESC) as rank
          FROM users u
          LEFT JOIN quiz_sessions qs ON qs.user_id = u.id ${dateFilter}
          GROUP BY u.id
          ORDER BY score DESC
          LIMIT ?
        `).all(limit);
      }
    }

    // Find current user's position
    const myRank = entries.findIndex(e => e.id === userId) + 1;

    // Attach badges to each entry
    const withBadges = entries.map(e => ({
      ...e,
      isMe: e.id === userId,
      badges: db.prepare(`
        SELECT b.emoji FROM user_badges ub 
        JOIN badges b ON b.id = ub.badge_id 
        WHERE ub.user_id = ? LIMIT 4
      `).all(e.id).map(b => b.emoji)
    }));

    res.json({
      entries: withBadges,
      myRank: myRank || null,
      type
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
