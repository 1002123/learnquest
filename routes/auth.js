// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db/database');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/register
 * Body: { username, email, password, displayName }
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const initials = (displayName || username).slice(0, 2).toUpperCase();

    db.prepare(`
      INSERT INTO users (id, username, email, password, display_name, avatar_initials, last_active)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, username, email, hashed, displayName || username, initials);

    db.prepare(`
      INSERT INTO user_stats (user_id) VALUES (?)
    `).run(id);

    // Create default daily quests
    createDailyQuests(db, id);

    const token = generateToken({ userId: id, username, email });
    const user = db.prepare('SELECT id, username, email, display_name, avatar_initials, level, xp, streak, elo, title FROM users WHERE id = ?').get(id);

    res.status(201).json({ token, user: formatUser(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update streak
    const today = new Date().toISOString().split('T')[0];
    const lastActive = user.last_active ? user.last_active.split('T')[0] : null;
    let newStreak = user.streak;

    if (lastActive) {
      const diffDays = Math.floor((new Date(today) - new Date(lastActive)) / 86400000);
      if (diffDays === 1) newStreak++;
      else if (diffDays > 1) newStreak = 1;
      // same day: no change
    } else {
      newStreak = 1;
    }

    db.prepare(`UPDATE users SET last_active = datetime('now'), streak = ? WHERE id = ?`).run(newStreak, user.id);

    // Ensure daily quests exist for today
    createDailyQuests(db, user.id);

    const token = generateToken({ userId: user.id, username: user.username, email: user.email });
    const updated = db.prepare('SELECT id, username, email, display_name, avatar_initials, level, xp, xp_to_next, streak, elo, title FROM users WHERE id = ?').get(user.id);

    res.json({ token, user: formatUser(updated) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/refresh
 * Body: { token }
 */
router.post('/refresh', (req, res) => {
  // In production use refresh tokens; for now re-issue on valid token
  try {
    const jwt = require('jsonwebtoken');
    const { token } = req.body;
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'learnquest_dev_secret');
    const newToken = generateToken({ userId: payload.userId, username: payload.username, email: payload.email });
    res.json({ token: newToken });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

function createDailyQuests(db, userId) {
  const today = new Date().toISOString().split('T')[0];
  const existing = db.prepare('SELECT id FROM daily_quests WHERE user_id = ? AND quest_date = ?').get(userId, today);
  if (existing) return;

  const quests = [
    { id: uuidv4(), quest_type: 'quiz', title: 'Complete 3 Challenges', description: 'Data Structures', xp_reward: 90 },
    { id: uuidv4(), quest_type: 'battle', title: 'Win a Peer Battle', description: '1v1 Quiz Duel', xp_reward: 60 },
    { id: uuidv4(), quest_type: 'teach', title: 'Teach a Concept', description: 'Learn by Teaching mode', xp_reward: 40 },
  ];

  const insert = db.prepare(`
    INSERT INTO daily_quests (id, user_id, quest_type, title, description, xp_reward, quest_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const q of quests) insert.run(q.id, userId, q.quest_type, q.title, q.description, q.xp_reward, today);
}

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
    title: u.title
  };
}

module.exports = router;
