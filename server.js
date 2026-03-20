// server.js — LearnQuest Backend
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { getDB } = require('./db/database');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const quizRoutes = require('./routes/quiz');
const battleRoutes = require('./routes/battle');
const leaderboardRoutes = require('./routes/leaderboard');
const mentorRoutes = require('./routes/mentor');
const skilltreeRoutes = require('./routes/skilltree');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5500,http://127.0.0.1:5500').split(',');

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (e.g. curl, mobile apps, same-origin file://)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many auth attempts, please try again later.' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'AI request limit reached. Wait 1 minute.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/quiz/generate', aiLimiter);
app.use('/api/quiz/reverse/evaluate', aiLimiter);
app.use('/api/quiz/teach/evaluate', aiLimiter);
app.use('/api/mentor/chat', aiLimiter);
app.use('/api/mentor/study-plan/generate', aiLimiter);
app.use('/api/users/predictions', aiLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/quiz',        quizRoutes);
app.use('/api/battle',      battleRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/mentor',      mentorRoutes);
app.use('/api/skilltree',   skilltreeRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const db = getDB();
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get()?.cnt || 0;
  res.json({
    status: 'ok',
    service: 'LearnQuest API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    users: userCount,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// ─── API Documentation ────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    name: 'LearnQuest API',
    version: '1.0.0',
    description: 'AI-Powered Gamified Learning Platform Backend',
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Register new user',
        'POST /api/auth/login':    'Login and get JWT token',
        'POST /api/auth/refresh':  'Refresh JWT token',
      },
      users: {
        'GET /api/users/me':           'Get full user profile (auth required)',
        'GET /api/users/heatmap':      'Get 91-day activity heatmap',
        'GET /api/users/activity':     'Get recent activity feed',
        'GET /api/users/portfolio':    'Get portfolio items',
        'POST /api/users/portfolio':   'Add portfolio item',
        'GET /api/users/predictions':  'AI progress predictions',
      },
      quiz: {
        'POST /api/quiz/generate':          'Generate AI quiz questions',
        'POST /api/quiz/submit':            'Submit quiz result (awards XP)',
        'POST /api/quiz/adapt':             'Get adaptive difficulty suggestion',
        'GET /api/quiz/history':            'Quiz session history',
        'GET /api/quiz/mistakes':           'Mistake intelligence report',
        'POST /api/quiz/reverse/evaluate':  'Evaluate reverse mode submission',
        'POST /api/quiz/teach/evaluate':    'Evaluate teach mode explanation',
      },
      battle: {
        'GET /api/battle/opponents':    'Get matchmade opponents',
        'GET /api/battle/questions':    'Get random battle questions',
        'POST /api/battle/start':       'Start a battle',
        'POST /api/battle/result':      'Submit battle result (updates Elo)',
        'GET /api/battle/history':      'Battle history',
      },
      leaderboard: {
        'GET /api/leaderboard?type=weekly|monthly|alltime|battle': 'Get leaderboard',
      },
      mentor: {
        'POST /api/mentor/chat':                  'Chat with AI mentor',
        'GET /api/mentor/history':                'Get chat history',
        'GET /api/mentor/study-plan':             'Get current week study plan',
        'POST /api/mentor/study-plan/generate':   'AI-generate new study plan',
        'PATCH /api/mentor/study-plan/:id/toggle':'Toggle study task completion',
      },
      skilltree: {
        'GET /api/skilltree':                          'All subjects summary',
        'GET /api/skilltree/:subject':                 'Subject tree with user status',
        'POST /api/skilltree/:subject/:nodeId/unlock': 'Unlock/update node',
      },
    },
    auth: 'Bearer token in Authorization header',
    rateLimit: '200 req/15min; 10 AI req/min; 15 auth/15min',
  });
});

// ─── 404 & Error Handler ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

app.use((err, req, res, next) => {
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
// Initialize DB eagerly on startup
getDB();

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   ⚡  LearnQuest API  — Running!      ║
╠═══════════════════════════════════════╣
║  Port    : ${PORT}                         ║
║  Env     : ${(process.env.NODE_ENV || 'development').padEnd(12)}           ║
║  DB      : ${(process.env.DB_PATH || './learnquest.db').padEnd(20)}   ║
║  Docs    : http://localhost:${PORT}/api   ║
║  Health  : http://localhost:${PORT}/health║
╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
