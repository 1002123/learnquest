// db/database.js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './learnquest.db';

let db;

function getDB() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_initials TEXT DEFAULT 'U',
      level       INTEGER DEFAULT 1,
      xp          INTEGER DEFAULT 0,
      xp_to_next  INTEGER DEFAULT 500,
      streak      INTEGER DEFAULT 0,
      last_active TEXT,
      elo         INTEGER DEFAULT 1000,
      title       TEXT DEFAULT 'Newcomer',
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- User stats (denormalized for fast leaderboard queries)
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id       TEXT PRIMARY KEY REFERENCES users(id),
      total_quizzes INTEGER DEFAULT 0,
      avg_accuracy  REAL DEFAULT 0,
      battle_wins   INTEGER DEFAULT 0,
      battle_losses INTEGER DEFAULT 0,
      total_xp_earned INTEGER DEFAULT 0,
      streak_insurance INTEGER DEFAULT 2,
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- Quiz sessions
    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      topic       TEXT NOT NULL,
      difficulty  TEXT NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
      score       INTEGER NOT NULL,
      total       INTEGER NOT NULL,
      accuracy    REAL NOT NULL,
      xp_earned   INTEGER NOT NULL,
      time_taken  INTEGER NOT NULL,
      mode        TEXT DEFAULT 'quiz' CHECK(mode IN ('quiz','reverse','story','teach','battle')),
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Question attempts (for mistake intelligence)
    CREATE TABLE IF NOT EXISTS question_attempts (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES quiz_sessions(id),
      user_id     TEXT NOT NULL REFERENCES users(id),
      topic       TEXT NOT NULL,
      concept     TEXT,
      is_correct  INTEGER NOT NULL,
      time_taken  REAL,
      difficulty  TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Skill progress per topic
    CREATE TABLE IF NOT EXISTS skill_progress (
      user_id     TEXT NOT NULL REFERENCES users(id),
      topic       TEXT NOT NULL,
      mastery_pct REAL DEFAULT 0,
      xp_earned   INTEGER DEFAULT 0,
      quizzes_done INTEGER DEFAULT 0,
      last_studied TEXT,
      PRIMARY KEY (user_id, topic)
    );

    -- Skill tree nodes
    CREATE TABLE IF NOT EXISTS skill_nodes (
      user_id     TEXT NOT NULL REFERENCES users(id),
      node_id     TEXT NOT NULL,
      subject     TEXT NOT NULL,
      status      TEXT DEFAULT 'locked' CHECK(status IN ('locked','unlocked','in_progress','mastered')),
      unlocked_at TEXT,
      PRIMARY KEY (user_id, node_id)
    );

    -- Battles
    CREATE TABLE IF NOT EXISTS battles (
      id            TEXT PRIMARY KEY,
      challenger_id TEXT NOT NULL REFERENCES users(id),
      opponent_id   TEXT,
      opponent_name TEXT,
      opponent_elo  INTEGER,
      is_bot        INTEGER DEFAULT 0,
      topic         TEXT,
      rounds        INTEGER DEFAULT 5,
      challenger_score INTEGER DEFAULT 0,
      opponent_score   INTEGER DEFAULT 0,
      winner_id     TEXT,
      elo_change    INTEGER DEFAULT 0,
      status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','complete')),
      created_at    TEXT DEFAULT (datetime('now')),
      completed_at  TEXT
    );

    -- Badges
    CREATE TABLE IF NOT EXISTS badges (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      emoji       TEXT NOT NULL,
      description TEXT,
      condition   TEXT
    );

    CREATE TABLE IF NOT EXISTS user_badges (
      user_id     TEXT NOT NULL REFERENCES users(id),
      badge_id    TEXT NOT NULL REFERENCES badges(id),
      earned_at   TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, badge_id)
    );

    -- Squads
    CREATE TABLE IF NOT EXISTS squads (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      rank        INTEGER DEFAULT 0,
      goal_total  INTEGER DEFAULT 20,
      goal_done   INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS squad_members (
      squad_id    TEXT NOT NULL REFERENCES squads(id),
      user_id     TEXT NOT NULL REFERENCES users(id),
      joined_at   TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (squad_id, user_id)
    );

    -- Daily quests
    CREATE TABLE IF NOT EXISTS daily_quests (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      quest_type  TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      xp_reward   INTEGER DEFAULT 30,
      is_complete INTEGER DEFAULT 0,
      quest_date  TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Mentor chat history
    CREATE TABLE IF NOT EXISTS mentor_messages (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content     TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Activity log (for heatmap + feed)
    CREATE TABLE IF NOT EXISTS activity_log (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      activity_type TEXT NOT NULL,
      description TEXT,
      xp_earned   INTEGER DEFAULT 0,
      icon        TEXT DEFAULT '⚡',
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Portfolio items
    CREATE TABLE IF NOT EXISTS portfolio_items (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      title       TEXT NOT NULL,
      description TEXT,
      difficulty  TEXT,
      tags        TEXT,
      share_link  TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Study plans
    CREATE TABLE IF NOT EXISTS study_plan_items (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      day_of_week TEXT NOT NULL,
      task        TEXT NOT NULL,
      duration_min INTEGER DEFAULT 30,
      is_done     INTEGER DEFAULT 0,
      week_start  TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_quiz_sessions_created ON quiz_sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_question_attempts_user ON question_attempts(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mentor_messages_user ON mentor_messages(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_daily_quests_user_date ON daily_quests(user_id, quest_date);
  `);

  // Seed badges
  seedBadges();
}

function seedBadges() {
  const badges = [
    { id: 'streak_master', name: 'Streak Master', emoji: '🔥', description: '7-day streak', condition: 'streak >= 7' },
    { id: 'speed_demon', name: 'Speed Demon', emoji: '⚡', description: 'Complete quiz under 60s', condition: 'quiz_time < 60' },
    { id: 'sharpshooter', name: 'Sharpshooter', emoji: '🎯', description: '90%+ accuracy on a quiz', condition: 'accuracy >= 90' },
    { id: 'brain_power', name: 'Brain Power', emoji: '🧠', description: 'Complete 10 quizzes', condition: 'total_quizzes >= 10' },
    { id: 'battle_winner', name: 'Battle Winner', emoji: '⚔️', description: 'Win 10 battles', condition: 'battle_wins >= 10' },
    { id: 'teacher', name: 'Teacher', emoji: '📖', description: 'Teach 5 concepts', condition: 'teach_sessions >= 5' },
    { id: 'quiz_king', name: 'Quiz King', emoji: '👑', description: 'Reach #1 leaderboard', condition: 'leaderboard_rank == 1' },
    { id: 'perfect_score', name: 'Perfect Score', emoji: '🌟', description: '5/5 on Hard difficulty', condition: 'hard_perfect == true' },
    { id: 'reverse_master', name: 'Reverse Master', emoji: '🔄', description: '10 reverse mode wins', condition: 'reverse_wins >= 10' },
    { id: 'story_hero', name: 'Story Hero', emoji: '🎭', description: 'Complete a story arc', condition: 'story_complete == true' },
    { id: 'diamond_mind', name: 'Diamond Mind', emoji: '💎', description: 'Reach Level 20', condition: 'level >= 20' },
    { id: 'graduated', name: 'Graduated', emoji: '🎓', description: 'Master all subjects', condition: 'all_mastered == true' },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO badges (id, name, emoji, description, condition)
    VALUES (@id, @name, @emoji, @description, @condition)
  `);
  for (const b of badges) insert.run(b);
}

module.exports = { getDB };
