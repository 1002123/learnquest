// routes/mentor.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const { mentorChat, generateStudyPlan } = require('../services/anthropic');

const router = express.Router();

// Canned responses for common queries (fast path, no AI call needed)
const CANNED = {
  'binary tree': "A binary tree has each node with at most 2 children. Key traversals: Inorder (left→root→right), Preorder (root→left→right), Postorder (left→right→root). Want a practice quiz on trees? 🌳",
  'study plan': null, // handled by AI
  'weak': null, // handled dynamically
  'placement': "For placements: 1) Focus on DSA (arrays, trees, graphs, DP) 2) Do 2 Peer Battles daily 3) Complete Career Sim tasks. Portfolio + consistent streak = strong profile! 🚀",
  'motivat': "You're making real progress! Consistent daily practice beats cramming. Even 15 min/day compounds into 90+ hours over 6 months. One more challenge today? 🔥",
  'recursion': "Recursion is a function calling itself with a smaller problem until it hits a base case. Classic example: factorial(n) = n * factorial(n-1). Base case: factorial(0) = 1. The key is always defining when to STOP! 🌀",
};

/**
 * POST /api/mentor/chat
 * Body: { message }
 */
router.post('/chat', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    const db = getDB();
    const { userId } = req.user;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
    const skills = db.prepare('SELECT * FROM skill_progress WHERE user_id = ?').all(userId);
    const skillMap = skills.reduce((a, s) => { a[s.topic] = s.mastery_pct; return a; }, {});

    // Save user message
    db.prepare(`INSERT INTO mentor_messages (id, user_id, role, content) VALUES (?, ?, 'user', ?)`).run(uuidv4(), userId, message);

    // Fetch recent history (last 10 messages)
    const history = db.prepare(`
      SELECT role, content FROM mentor_messages
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 10
    `).all(userId).reverse();

    // Check canned responses first
    const low = message.toLowerCase();
    const cannedKey = Object.keys(CANNED).find(k => low.includes(k));
    let reply;

    if (cannedKey === 'weak') {
      // Generate dynamic weakness report
      const weakTopics = skills
        .sort((a, b) => a.mastery_pct - b.mastery_pct)
        .slice(0, 3)
        .map(s => `${s.topic} (${Math.round(s.mastery_pct)}%)`);
      reply = `Your top 3 weak areas: ${weakTopics.join(', ') || 'still building your profile'}. ${weakTopics[0] ? `Start with ${skills[0]?.topic} — it unlocks more advanced nodes. ` : ''}Want a focused 3-day bootcamp on your weakest topic? 💪`;
    } else if (cannedKey && CANNED[cannedKey]) {
      reply = CANNED[cannedKey];
    } else {
      // AI response
      try {
        reply = await mentorChat({
          userMessage: message,
          history: history.slice(-6),
          userContext: {
            name: user.display_name,
            level: user.level,
            xp: user.xp,
            streak: user.streak,
            avgAccuracy: Math.round(stats?.avg_accuracy || 0),
            skills: {
              dsa: Math.round(skillMap['Data Structures'] || 0),
              networks: Math.round(skillMap['Computer Networks'] || 0),
              db: Math.round(skillMap['Database Systems'] || 0)
            },
            weakTopics: skills.sort((a, b) => a.mastery_pct - b.mastery_pct).slice(0, 2).map(s => s.topic)
          }
        });
      } catch (err) {
        console.warn('AI mentor failed:', err.message);
        reply = `Great question! I'm analyzing your progress... Focus on your weakest area with consistent daily practice. You've got ${user.streak} days of streak going — don't break it! 💪`;
      }
    }

    // Save assistant message
    db.prepare(`INSERT INTO mentor_messages (id, user_id, role, content) VALUES (?, ?, 'assistant', ?)`).run(uuidv4(), userId, reply);

    res.json({ reply, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Mentor chat error:', err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

/**
 * GET /api/mentor/history
 */
router.get('/history', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const limit = parseInt(req.query.limit) || 30;
    const messages = db.prepare(`
      SELECT role, content, created_at FROM mentor_messages
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(req.user.userId, limit).reverse();
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

/**
 * GET /api/mentor/study-plan
 */
router.get('/study-plan', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.user;
    const today = new Date().toISOString().split('T')[0];

    // Get start of current week (Monday)
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(d.setDate(diff)).toISOString().split('T')[0];

    const items = db.prepare(`
      SELECT * FROM study_plan_items
      WHERE user_id = ? AND week_start = ?
      ORDER BY CASE day_of_week
        WHEN 'MON' THEN 1 WHEN 'TUE' THEN 2 WHEN 'WED' THEN 3
        WHEN 'THU' THEN 4 WHEN 'FRI' THEN 5 WHEN 'SAT' THEN 6 WHEN 'SUN' THEN 7
      END
    `).all(userId, weekStart);

    res.json({ items, weekStart });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch study plan' });
  }
});

/**
 * POST /api/mentor/study-plan/generate
 * AI-generates a new weekly plan
 */
router.post('/study-plan/generate', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.user;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const skills = db.prepare('SELECT * FROM skill_progress WHERE user_id = ? ORDER BY mastery_pct ASC').all(userId);

    // Calculate week start
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(new Date().setDate(diff)).toISOString().split('T')[0];

    // Remove old plan for this week
    db.prepare('DELETE FROM study_plan_items WHERE user_id = ? AND week_start = ?').run(userId, weekStart);

    let plan;
    try {
      plan = await generateStudyPlan({
        userContext: {
          name: user.display_name,
          level: user.level,
          streak: user.streak,
          weakTopics: skills.slice(0, 3).map(s => s.topic)
        }
      });
    } catch {
      // Fallback plan
      plan = [
        { day: 'MON', task: 'Trees: Inorder, Preorder traversal + 5 problems', duration_min: 45 },
        { day: 'TUE', task: 'Trees: BST insertion & search', duration_min: 40 },
        { day: 'WED', task: 'Peer Battle practice (3 rounds)', duration_min: 30 },
        { day: 'THU', task: 'TCP/IP: 3-way handshake + quiz', duration_min: 35 },
        { day: 'FRI', task: 'Reverse Mode: Algorithm outputs (5 problems)', duration_min: 40 },
        { day: 'SAT', task: 'Story Mode: Startup bug-fix simulation', duration_min: 50 },
        { day: 'SUN', task: 'Review week + Boss Battle attempt', duration_min: 60 },
      ];
    }

    const insert = db.prepare(`
      INSERT INTO study_plan_items (id, user_id, day_of_week, task, duration_min, week_start)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of plan) {
      insert.run(uuidv4(), userId, item.day, item.task, item.duration_min || 30, weekStart);
    }

    const items = db.prepare('SELECT * FROM study_plan_items WHERE user_id = ? AND week_start = ?').all(userId, weekStart);
    res.json({ items, weekStart });
  } catch (err) {
    console.error('Study plan generate error:', err);
    res.status(500).json({ error: 'Failed to generate study plan' });
  }
});

/**
 * PATCH /api/mentor/study-plan/:id/toggle
 */
router.patch('/study-plan/:id/toggle', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const item = db.prepare('SELECT * FROM study_plan_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const newDone = item.is_done ? 0 : 1;
    db.prepare('UPDATE study_plan_items SET is_done = ? WHERE id = ?').run(newDone, req.params.id);

    // Award XP for completing study task
    if (newDone) {
      db.prepare(`UPDATE users SET xp = xp + 10 WHERE id = ?`).run(req.user.userId);
      db.prepare(`INSERT INTO activity_log (id, user_id, activity_type, description, xp_earned, icon) VALUES (?, ?, 'study', ?, 10, '📅')`).run(uuidv4(), req.user.userId, `Completed: ${item.task.slice(0, 50)}`);
    }

    res.json({ isDone: !!newDone });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle item' });
  }
});

module.exports = router;
