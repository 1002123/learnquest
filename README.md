# ⚡ LearnQuest — AI Gamified Learning Platform

> Learn like a game. Level up like a pro.

LearnQuest is an AI-powered gamified learning platform for CS 
undergraduates. It combines adaptive quizzes, peer battles, skill 
trees and an AI mentor to make studying addictive and effective.

## 🚀 Demo Video
[Click here to watch demo](YOUR_YOUTUBE_LINK_HERE)

## 🌟 Features
- AI Challenge Arena — Adaptive MCQ generation via Groq AI
- Peer Battle Arena — Real-time 1v1 quiz duels with Elo ranking
- Skill Tree — RPG-style learning with secret nodes
- AI Mentor — Personalized coach with weekly study plans
- Progress Dashboard — Heatmap, mistake intelligence, predictions
- Gamification — XP, levels, streaks, badges, daily quests

## ⚙️ Setup Instructions

### 1. Clone the repo
git clone https://github.com/1002123/learnquest.git
cd learnquest

### 2. Install dependencies
npm install

### 3. Create .env file
cp .env.example .env
Add your Groq API key inside .env
Get free key at: https://console.groq.com

### 4. Start server
npm start

### 5. Open browser
http://localhost:3001

## 🛠️ Tech Stack
- Frontend: HTML5, CSS3, Vanilla JavaScript
- Backend: Node.js, Express.js
- Database: SQLite
- AI: Groq API (LLaMA 3.3-70b)
- Auth: JWT + Bcrypt
- Security: Helmet.js, CORS, Rate Limiting

## 🏆 Credits
- Groq API — AI question generation and mentor chat
- LLaMA 3.3-70b — Large language model by Meta
- Express.js — Web framework
- better-sqlite3 — SQLite database driver
- bcryptjs — Password hashing
- jsonwebtoken — JWT authentication
- DM Serif Display — Google Fonts
- Plus Jakarta Sans — Google Fonts

## 📚 References
- Groq Docs: https://console.groq.com/docs
- Express.js: https://expressjs.com
- SQLite: https://www.sqlite.org
- JWT: https://jwt.io
- Elo Rating: https://en.wikipedia.org/wiki/Elo_rating_system

## 👨‍💻 Developed By
Kotapuri Harshitha — SRM Institute of Science and Technology

## 📄 License
MIT License