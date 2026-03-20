// routes/skilltree.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Skill tree definitions — subjects and nodes with unlock dependencies
const SKILL_TREES = {
  dsa: {
    name: 'Data Structures & Algorithms',
    emoji: '🏗️',
    nodes: [
      { id: 'arrays',        label: 'Arrays',           emoji: '📊', level: 1, xp: 240, deps: [] },
      { id: 'linked_lists',  label: 'Linked Lists',     emoji: '🔗', level: 1, xp: 180, deps: [] },
      { id: 'stacks_queues', label: 'Stacks & Queues',  emoji: '📦', level: 1, xp: 160, deps: [] },
      { id: 'trees',         label: 'Trees',            emoji: '🌳', level: 2, xp: 200, deps: ['arrays', 'linked_lists'] },
      { id: 'hashing',       label: 'Hashing',          emoji: '#️⃣',  level: 2, xp: 180, deps: ['arrays'] },
      { id: 'sorting',       label: 'Sorting',          emoji: '↕️',  level: 2, xp: 160, deps: ['arrays'] },
      { id: 'graphs',        label: 'Graphs',           emoji: '🕸️',  level: 3, xp: 280, deps: ['trees'] },
      { id: 'dynamic_prog',  label: 'Dynamic Prog.',    emoji: '🎯',  level: 3, xp: 320, deps: ['trees', 'sorting'] },
      { id: 'seg_trees',     label: 'Segment Trees',    emoji: '🌟',  level: 3, xp: 400, deps: ['trees'], secret: true },
    ]
  },
  ml: {
    name: 'Machine Learning',
    emoji: '🤖',
    nodes: [
      { id: 'linear_reg',    label: 'Linear Regression', emoji: '📈', level: 1, xp: 150, deps: [] },
      { id: 'classification',label: 'Classification',    emoji: '🤖', level: 2, xp: 200, deps: ['linear_reg'] },
      { id: 'neural_nets',   label: 'Neural Networks',   emoji: '🧠', level: 3, xp: 350, deps: ['classification'] },
      { id: 'cnn',           label: 'CNNs',              emoji: '🖼️',  level: 4, xp: 400, deps: ['neural_nets'] },
    ]
  },
  os: {
    name: 'Operating Systems',
    emoji: '💻',
    nodes: [
      { id: 'processes',     label: 'Processes',        emoji: '💻', level: 1, xp: 160, deps: [] },
      { id: 'memory',        label: 'Memory Mgmt',      emoji: '🧮', level: 2, xp: 200, deps: ['processes'] },
      { id: 'filesystems',   label: 'File Systems',     emoji: '📁', level: 3, xp: 240, deps: ['memory'] },
      { id: 'scheduling',    label: 'CPU Scheduling',   emoji: '⏱️',  level: 3, xp: 220, deps: ['processes'] },
    ]
  },
  db: {
    name: 'Databases',
    emoji: '🗄️',
    nodes: [
      { id: 'sql_basics',    label: 'SQL Basics',       emoji: '🗄️',  level: 1, xp: 140, deps: [] },
      { id: 'normalization', label: 'Normalization',    emoji: '📐', level: 2, xp: 180, deps: ['sql_basics'] },
      { id: 'indexing',      label: 'Indexing',         emoji: '⚡', level: 2, xp: 160, deps: ['sql_basics'] },
      { id: 'mini_search',   label: 'Mini Search Engine',emoji: '🔍',level: 3, xp: 500, deps: ['indexing'], secret: true },
    ]
  },
  net: {
    name: 'Networks',
    emoji: '🌐',
    nodes: [
      { id: 'osi_model',     label: 'OSI Model',        emoji: '🌐', level: 1, xp: 120, deps: [] },
      { id: 'tcp_ip',        label: 'TCP/IP',           emoji: '🔗', level: 2, xp: 160, deps: ['osi_model'] },
      { id: 'routing',       label: 'Routing Protocols',emoji: '🗺️', level: 3, xp: 220, deps: ['tcp_ip'] },
      { id: 'security',      label: 'Network Security', emoji: '🔒', level: 4, xp: 280, deps: ['routing'] },
    ]
  }
};

/**
 * GET /api/skilltree/:subject
 * Returns the tree with user's unlock status
 */
router.get('/:subject', authMiddleware, (req, res) => {
  try {
    const { subject } = req.params;
    const tree = SKILL_TREES[subject];
    if (!tree) return res.status(404).json({ error: 'Subject not found' });

    const db = getDB();
    const { userId } = req.user;

    // Get user's node statuses
    const userNodes = db.prepare('SELECT node_id, status FROM skill_nodes WHERE user_id = ? AND subject = ?').all(userId, subject);
    const statusMap = userNodes.reduce((a, n) => { a[n.node_id] = n.status; return a; }, {});

    // For new users — auto-unlock level 1 nodes
    const firstLevelNodes = tree.nodes.filter(n => n.level === 1);
    for (const node of firstLevelNodes) {
      if (!statusMap[node.id]) {
        db.prepare(`INSERT OR IGNORE INTO skill_nodes (user_id, node_id, subject, status) VALUES (?, ?, ?, 'unlocked')`).run(userId, node.id, subject);
        statusMap[node.id] = 'unlocked';
      }
    }

    // Compute full status considering dependencies
    const withStatus = tree.nodes.map(node => {
      let status = statusMap[node.id] || 'locked';

      // If deps are all mastered/unlocked, auto-unlock
      if (status === 'locked' && node.deps.length > 0) {
        const depsUnlocked = node.deps.every(dep => ['unlocked', 'in_progress', 'mastered'].includes(statusMap[dep]));
        if (depsUnlocked) {
          status = 'unlocked';
          db.prepare(`INSERT OR REPLACE INTO skill_nodes (user_id, node_id, subject, status) VALUES (?, ?, ?, 'unlocked')`).run(userId, node.id, subject);
        }
      }

      return {
        ...node,
        status,
        isSecret: node.secret || false
      };
    });

    // Overall subject progress
    const mastered = withStatus.filter(n => n.status === 'mastered').length;
    const progress = Math.round((mastered / tree.nodes.length) * 100);

    res.json({
      subject,
      name: tree.name,
      emoji: tree.emoji,
      nodes: withStatus,
      progress,
      masteredCount: mastered,
      totalNodes: tree.nodes.length
    });
  } catch (err) {
    console.error('Skill tree error:', err);
    res.status(500).json({ error: 'Failed to fetch skill tree' });
  }
});

/**
 * POST /api/skilltree/:subject/:nodeId/unlock
 * Unlocks or updates a node status
 */
router.post('/:subject/:nodeId/unlock', authMiddleware, (req, res) => {
  try {
    const { subject, nodeId } = req.params;
    const { status = 'in_progress' } = req.body;
    const db = getDB();
    const { userId } = req.user;

    const tree = SKILL_TREES[subject];
    if (!tree) return res.status(404).json({ error: 'Subject not found' });

    const node = tree.nodes.find(n => n.id === nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    db.prepare(`
      INSERT OR REPLACE INTO skill_nodes (user_id, node_id, subject, status, unlocked_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(userId, nodeId, subject, status);

    // If mastered — award XP and log
    if (status === 'mastered') {
      db.prepare(`UPDATE users SET xp = xp + ? WHERE id = ?`).run(node.xp, userId);
      db.prepare(`INSERT INTO activity_log (id, user_id, activity_type, description, xp_earned, icon) VALUES (?, ?, 'skill', ?, ?, '🌳')`).run(uuidv4(), userId, `Mastered: ${node.label}`, node.xp);

      // Check if this unlocks dependent nodes
      for (const n of tree.nodes) {
        if (n.deps.includes(nodeId)) {
          const existing = db.prepare('SELECT status FROM skill_nodes WHERE user_id = ? AND node_id = ?').get(userId, n.id);
          if (!existing || existing.status === 'locked') {
            db.prepare(`INSERT OR REPLACE INTO skill_nodes (user_id, node_id, subject, status, unlocked_at) VALUES (?, ?, ?, 'unlocked', datetime('now'))`).run(userId, n.id, subject);
          }
        }
      }
    }

    res.json({ success: true, nodeId, status, xpAwarded: status === 'mastered' ? node.xp : 0 });
  } catch (err) {
    console.error('Skill unlock error:', err);
    res.status(500).json({ error: 'Failed to unlock node' });
  }
});

/**
 * GET /api/skilltree (all subjects summary)
 */
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.user;

    const summary = Object.entries(SKILL_TREES).map(([subject, tree]) => {
      const userNodes = db.prepare('SELECT node_id, status FROM skill_nodes WHERE user_id = ? AND subject = ?').all(userId, subject);
      const mastered = userNodes.filter(n => n.status === 'mastered').length;
      return {
        subject,
        name: tree.name,
        emoji: tree.emoji,
        progress: Math.round((mastered / tree.nodes.length) * 100),
        mastered,
        total: tree.nodes.length
      };
    });

    res.json({ subjects: summary });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch skill tree summary' });
  }
});

module.exports = router;
