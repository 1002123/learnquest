/**
 * LearnQuest API Client
 * Drop this <script> tag into your index.html just before the closing </body>
 * It patches the existing frontend to call the real backend instead of Anthropic directly.
 *
 * Usage:
 *   <script src="api-client.js"></script>
 *
 * Set LEARNQUEST_API_URL to your backend URL (default: http://localhost:3001)
 */

(function () {
  const API_BASE = window.LEARNQUEST_API_URL || 'http://localhost:3001';
  let token = localStorage.getItem('lq_token');
  let currentUser = JSON.parse(localStorage.getItem('lq_user') || 'null');

  // ─── Core HTTP helper ────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      // Token expired — clear and redirect to login
      localStorage.removeItem('lq_token');
      localStorage.removeItem('lq_user');
      token = null;
      showAuthModal();
      return null;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const get    = (path) => api('GET', path);
  const post   = (path, body) => api('POST', path, body);
  const patch  = (path, body) => api('PATCH', path, body);

  // ─── Auth ────────────────────────────────────────────────────────────────────
  window.LQ = {
    api,

    async register(username, email, password, displayName) {
      const data = await post('/api/auth/register', { username, email, password, displayName });
      if (data) { token = data.token; currentUser = data.user; persistAuth(data); }
      return data;
    },

    async login(email, password) {
      const data = await post('/api/auth/login', { email, password });
      if (data) { token = data.token; currentUser = data.user; persistAuth(data); syncUserToUI(data.user); }
      return data;
    },

    logout() {
      localStorage.removeItem('lq_token');
      localStorage.removeItem('lq_user');
      token = null;
      currentUser = null;
    },

    isLoggedIn() { return !!token; },
    getUser() { return currentUser; },

    // ─── User ────────────────────────────────────────────────────────────────
    async getProfile() {
      return get('/api/users/me');
    },

    async getHeatmap() {
      return get('/api/users/heatmap');
    },

    async getPredictions() {
      return get('/api/users/predictions');
    },

    async getActivity(limit = 20) {
      return get('/api/users/activity?limit=' + limit);
    },

    // ─── Quiz ────────────────────────────────────────────────────────────────
    async generateQuiz(topic, difficulty, count = 5, mode = 'quiz') {
      return post('/api/quiz/generate', { topic, difficulty, count, mode });
    },

    async submitQuiz({ topic, difficulty, mode, score, total, timeTaken, attempts }) {
      const result = await post('/api/quiz/submit', { topic, difficulty, mode, score, total, timeTaken, attempts });
      if (result && currentUser) {
        currentUser.xp = result.newXP;
        currentUser.level = result.newLevel;
        currentUser.title = result.newTitle;
        syncUserToUI(currentUser);
        if (result.leveledUp) triggerLevelUp(result.newLevel, result.newTitle);
        if (result.newBadges?.length) result.newBadges.forEach(b => showToast('🏆', 'Badge Unlocked!', b));
      }
      return result;
    },

    async adaptDifficulty(history, currentDifficulty) {
      return post('/api/quiz/adapt', { history, currentDifficulty });
    },

    async evaluateReverse(code, expectedOutput) {
      return post('/api/quiz/reverse/evaluate', { code, expectedOutput });
    },

    async evaluateTeach(explanation, concept) {
      return post('/api/quiz/teach/evaluate', { explanation, concept });
    },

    async getMistakes() {
      return get('/api/quiz/mistakes');
    },

    // ─── Battle ──────────────────────────────────────────────────────────────
    async getBattleOpponents() {
      return get('/api/battle/opponents');
    },

    async getBattleQuestions() {
      return get('/api/battle/questions');
    },

    async startBattle({ opponentName, opponentElo, isBot = true, topic }) {
      return post('/api/battle/start', { opponentName, opponentElo, isBot, topic });
    },

    async submitBattleResult(battleId, myScore, opponentScore) {
      const result = await post('/api/battle/result', { battleId, myScore, opponentScore });
      if (result && currentUser) {
        currentUser.elo = result.newElo;
        syncUserToUI(currentUser);
      }
      return result;
    },

    // ─── Leaderboard ─────────────────────────────────────────────────────────
    async getLeaderboard(type = 'weekly', limit = 20) {
      return get(`/api/leaderboard?type=${type}&limit=${limit}`);
    },

    // ─── Mentor ──────────────────────────────────────────────────────────────
    async mentorChat(message) {
      return post('/api/mentor/chat', { message });
    },

    async getMentorHistory() {
      return get('/api/mentor/history');
    },

    async getStudyPlan() {
      return get('/api/mentor/study-plan');
    },

    async generateStudyPlan() {
      return post('/api/mentor/study-plan/generate', {});
    },

    async toggleStudyTask(itemId) {
      return patch('/api/mentor/study-plan/' + itemId + '/toggle', {});
    },

    // ─── Skill Tree ──────────────────────────────────────────────────────────
    async getSkillTree(subject) {
      return get('/api/skilltree/' + subject);
    },

    async getAllSkillTrees() {
      return get('/api/skilltree');
    },

    async unlockNode(subject, nodeId, status = 'in_progress') {
      return post(`/api/skilltree/${subject}/${nodeId}/unlock`, { status });
    },
  };

  // ─── UI Sync helpers ─────────────────────────────────────────────────────────
  function persistAuth({ token: t, user }) {
    localStorage.setItem('lq_token', t);
    localStorage.setItem('lq_user', JSON.stringify(user));
  }

  function syncUserToUI(user) {
    if (!user) return;
    const lv = document.getElementById('nav-lv');
    const xp = document.getElementById('nav-xp');
    const st = document.getElementById('nav-st');
    const av = document.querySelector('.av');
    if (lv) lv.textContent = user.level;
    if (xp) xp.textContent = Number(user.xp).toLocaleString();
    if (st) st.textContent = user.streak + 'd';
    if (av) { av.textContent = user.avatarInitials || user.displayName?.slice(0, 2).toUpperCase() || 'U'; }
    // Update hero greeting
    const heroH1 = document.querySelector('.hero-txt h1 span');
    if (heroH1) heroH1.textContent = user.displayName || user.username + '!';
    // Update level ring
    const rn = document.querySelector('.rn');
    if (rn) rn.textContent = user.level;
    const lwtit = document.querySelector('.lwtit');
    if (lwtit) lwtit.textContent = user.title;
    // XP bar
    const xpToNext = user.xpToNext || 500;
    const curXP = user.xp || 0;
    const xpbf = document.querySelector('.xpbf');
    if (xpbf) {
      // Approximate % within current level
      const pct = Math.min(100, Math.round((curXP % xpToNext) / xpToNext * 100));
      xpbf.style.width = pct + '%';
    }
    const lwsub = document.querySelector('.lwsub');
    if (lwsub) lwsub.textContent = `${Number(curXP).toLocaleString()} XP → Lv ${user.level + 1}`;
  }

  function triggerLevelUp(level, title) {
    const lunum = document.getElementById('lunum');
    const lusub = document.getElementById('lusub');
    const luov = document.getElementById('luov');
    if (lunum) lunum.textContent = level;
    if (lusub) lusub.textContent = `You've reached ${title}!`;
    if (luov) luov.classList.add('show');
  }

  // ─── Patch existing quiz flow to use backend ──────────────────────────────────
  // Override the startQuiz function to call backend instead of Anthropic directly
  const _origStartQuiz = window.startQuiz;
  window.startQuiz = async function () {
    if (!window.LQ.isLoggedIn()) {
      showAuthModal();
      return;
    }

    // Use the existing UI state variables (sT = topic, sD = difficulty)
    const topic = window.sT;
    const difficulty = window.sD || 'medium';
    const mode = window.curMode || 'quiz';

    if (!topic) return;

    // Show loading state (reuse existing UI)
    ['quiz-sel', 'qactive', 'rcard'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const qload = document.getElementById('qload');
    if (qload) qload.style.display = 'block';

    try {
      const data = await LQ.generateQuiz(topic, difficulty, 5, mode);
      if (!data) return;
      window.qs = data.questions;
      window.cQ = 0;
      window.sc = 0;
      window.pH = [];
      window.mLog = [];
      window.st = Date.now();
      if (qload) qload.style.display = 'none';
      const qa = document.getElementById('qactive');
      if (qa) qa.style.display = 'block';
      if (typeof window.showQ === 'function') window.showQ();
    } catch (err) {
      console.error('Quiz start error:', err);
      // Fallback to original if backend fails
      if (_origStartQuiz) _origStartQuiz();
    }
  };

  // Patch sendMsg to use backend mentor
  const _origSendMsg = window.sendMsg;
  window.sendMsg = async function (preMsg) {
    if (!window.LQ.isLoggedIn()) {
      showAuthModal();
      return;
    }
    const input = document.getElementById('chat-in');
    const msg = preMsg || input?.value?.trim();
    if (!msg) return;
    if (input) input.value = '';

    if (typeof window.addChat === 'function') window.addChat(msg, 'user', 'YOU');

    try {
      const data = await LQ.mentorChat(msg);
      if (data?.reply && typeof window.addChat === 'function') {
        window.addChat(data.reply, 'ai', '🤖 MENTOR AI');
      }
    } catch {
      if (_origSendMsg) _origSendMsg(preMsg);
    }
  };

  // Patch evalReverse
  window.evalReverse = async function () {
    if (!window.LQ.isLoggedIn()) { showAuthModal(); return; }
    const code = document.getElementById('rev-input')?.value;
    const output = document.getElementById('rev-output')?.textContent;
    if (!code?.trim()) { showToast('⚠️', 'Write Code First!', 'Enter your solution before evaluating.'); return; }
    const fb = document.getElementById('rev-feedback');
    if (fb) { fb.style.display = 'block'; fb.textContent = '🤖 AI evaluating your logic...'; }
    try {
      const data = await LQ.evaluateReverse(code, output);
      if (fb && data?.feedback) { fb.textContent = '🤖 ' + data.feedback; }
      showToast('✅', 'Evaluated!', `+${data?.xpEarned || 20} XP for Reverse Mode`);
    } catch {
      if (fb) fb.textContent = '✅ On the right track! Think about the pattern in the output.';
    }
  };

  // Patch evalTeach
  window.evalTeach = async function () {
    if (!window.LQ.isLoggedIn()) { showAuthModal(); return; }
    const txt = document.getElementById('teach-input')?.value;
    if (!txt?.trim()) { showToast('⚠️', 'Write First!', 'Type your explanation before submitting.'); return; }
    const fb = document.getElementById('teach-fb');
    if (fb) { fb.style.display = 'block'; fb.textContent = '🤖 AI evaluating clarity...'; }
    try {
      const data = await LQ.evaluateTeach(txt, 'recursion');
      if (fb && data?.feedback) { fb.textContent = '🤖 ' + data.feedback; }
      showToast('📖', 'Teach Mode!', `+${data?.xpEarned || 40} XP for teaching!`);
    } catch {
      if (fb) fb.textContent = '✅ Great effort! Add a concrete example for extra clarity. Score: 7/10.';
    }
  };

  // ─── Auth Modal ──────────────────────────────────────────────────────────────
  function showAuthModal() {
    // Only inject once
    if (document.getElementById('lq-auth-modal')) {
      document.getElementById('lq-auth-modal').style.display = 'flex';
      return;
    }
    const modal = document.createElement('div');
    modal.id = 'lq-auth-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75);backdrop-filter:blur(8px)';
    modal.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:20px;padding:36px 40px;width:100%;max-width:400px;box-shadow:0 0 40px var(--pglow)">
        <div style="font-family:'DM Serif Display',serif;font-size:1.5rem;color:var(--text);margin-bottom:4px;text-align:center">⚡ LearnQuest</div>
        <div style="font-size:.82rem;color:var(--text2);text-align:center;margin-bottom:22px">Sign in to save your progress</div>
        <div id="lq-auth-err" style="display:none;background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);border-radius:10px;padding:10px 14px;font-size:.79rem;color:var(--danger);margin-bottom:14px"></div>
        <div id="lq-login-form">
          <input id="lq-email" placeholder="Email" type="email" style="width:100%;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;font-size:.85rem;margin-bottom:10px"/>
          <input id="lq-pass" placeholder="Password" type="password" style="width:100%;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;font-size:.85rem;margin-bottom:14px"/>
          <button onclick="window._lqLogin()" style="width:100%;padding:13px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--lav-500),var(--lav-400));color:#fff;font-weight:700;font-size:.9rem;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;margin-bottom:10px">Sign In →</button>
          <button onclick="document.getElementById('lq-login-form').style.display='none';document.getElementById('lq-reg-form').style.display='block'" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:.8rem;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif">Create Account</button>
        </div>
        <div id="lq-reg-form" style="display:none">
          <input id="lq-rname" placeholder="Display Name" style="width:100%;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;font-size:.85rem;margin-bottom:10px"/>
          <input id="lq-ruser" placeholder="Username" style="width:100%;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;font-size:.85rem;margin-bottom:10px"/>
          <input id="lq-remail" placeholder="Email" type="email" style="width:100%;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;font-size:.85rem;margin-bottom:10px"/>
          <input id="lq-rpass" placeholder="Password (min 6 chars)" type="password" style="width:100%;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;font-size:.85rem;margin-bottom:14px"/>
          <button onclick="window._lqRegister()" style="width:100%;padding:13px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--mint-500),var(--mint-400));color:#fff;font-weight:700;font-size:.9rem;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;margin-bottom:10px">Create Account →</button>
          <button onclick="document.getElementById('lq-reg-form').style.display='none';document.getElementById('lq-login-form').style.display='block'" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:.8rem;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif">Back to Login</button>
        </div>
        <button onclick="document.getElementById('lq-auth-modal').style.display='none'" style="width:100%;margin-top:12px;padding:9px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text3);font-size:.76rem;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif">Continue without saving</button>
      </div>`;
    document.body.appendChild(modal);
  }

  window._lqLogin = async function () {
    const email = document.getElementById('lq-email')?.value;
    const pass = document.getElementById('lq-pass')?.value;
    const errEl = document.getElementById('lq-auth-err');
    if (!email || !pass) { showErr('Email and password required'); return; }
    try {
      const data = await LQ.login(email, pass);
      if (data) {
        document.getElementById('lq-auth-modal').style.display = 'none';
        showToast('👋', `Welcome back, ${data.user.displayName}!`, `Level ${data.user.level} · ${data.user.streak}d streak`);
      }
    } catch (e) { showErr(e.message); }
    function showErr(msg) { if (errEl) { errEl.style.display = 'block'; errEl.textContent = msg; } }
  };

  window._lqRegister = async function () {
    const name = document.getElementById('lq-rname')?.value;
    const user = document.getElementById('lq-ruser')?.value;
    const email = document.getElementById('lq-remail')?.value;
    const pass = document.getElementById('lq-rpass')?.value;
    const errEl = document.getElementById('lq-auth-err');
    if (!name || !user || !email || !pass) { showErr('All fields required'); return; }
    try {
      const data = await LQ.register(user, email, pass, name);
      if (data) {
        document.getElementById('lq-auth-modal').style.display = 'none';
        showToast('🎉', `Welcome to LearnQuest, ${data.user.displayName}!`, 'Your journey starts now!');
        syncUserToUI(data.user);
      }
    } catch (e) { showErr(e.message); }
    function showErr(msg) { if (errEl) { errEl.style.display = 'block'; errEl.textContent = msg; } }
  };

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  // On load, if token exists, refresh user profile
  if (token && currentUser) {
    syncUserToUI(currentUser);
    // Silently refresh in background
    LQ.getProfile().then(data => {
      if (data?.user) {
        currentUser = data.user;
        localStorage.setItem('lq_user', JSON.stringify(currentUser));
        syncUserToUI(currentUser);
      }
    }).catch(() => {});
  } else {
    // Auto-show auth modal after a short delay if not logged in
    setTimeout(() => {
      if (!LQ.isLoggedIn()) showAuthModal();
    }, 1500);
  }

  console.log('⚡ LearnQuest API client loaded. Backend:', API_BASE);
})();
