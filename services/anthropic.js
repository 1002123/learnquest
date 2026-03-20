// services/anthropic.js  (powered by Groq API)
const https = require('https');

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Groq model options (all free tier):
// 'llama-3.3-70b-versatile'  — smartest, best for quiz gen & mentor chat
// 'llama-3.1-8b-instant'     — ultra fast, good for simple evaluations
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/**
 * Core wrapper for Groq's OpenAI-compatible chat completions API.
 */
function callGroq({ messages, system, max_tokens = 1200 }) {
  return new Promise((resolve, reject) => {
    const allMessages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages
    ];

    const body = JSON.stringify({
      model: MODEL,
      max_tokens,
      temperature: 0.7,
      messages: allMessages,
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'Groq API error'));
          } else {
            const text = parsed.choices?.[0]?.message?.content || '';
            resolve(text);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function generateQuizQuestions({ topic, difficulty, count = 5 }) {
  const prompt = `Generate ${count} MCQ questions on "${topic}" at ${difficulty} difficulty for undergrad CS students.
Return ONLY a JSON array, no markdown, no backticks, no extra text.
Format: [{"q":"question text","options":["A) option","B) option","C) option","D) option"],"answer":0,"concept":"concept name","error_type":"common mistake type","thinking_path":["Step 1: ...","Step 2: ...","Step 3: ..."]}]
answer is the 0-based index of the correct option.`;

  const text = await callGroq({ messages: [{ role: 'user', content: prompt }], max_tokens: 2000 });
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

async function evaluateReverse({ code, expectedOutput }) {
  return callGroq({
    messages: [{ role: 'user', content: `A student wrote: "${code}". Expected output: "${expectedOutput}". In 2-3 sentences: evaluate correctness, note bugs, suggest improvement. Be encouraging.` }],
    max_tokens: 300
  });
}

async function evaluateTeaching({ explanation, concept }) {
  return callGroq({
    messages: [{ role: 'user', content: `A CS student explained "${concept}": "${explanation}". Rate clarity 1-10, give 2 improvements, mention what they got right. Under 4 sentences, encouraging.` }],
    max_tokens: 300
  });
}

async function mentorChat({ userMessage, history, userContext }) {
  const system = `You are an encouraging AI mentor for ${userContext.name}, a CS undergrad on LearnQuest. Level ${userContext.level}, ${userContext.xp} XP, ${userContext.streak}-day streak. DSA ${userContext.skills?.dsa||0}%, Networks ${userContext.skills?.networks||0}%, DB ${userContext.skills?.db||0}%. Be educational, personalized, motivating. 3-5 sentences.`;
  return callGroq({
    system,
    messages: [...history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: userMessage }],
    max_tokens: 400
  });
}

async function generateStudyPlan({ userContext }) {
  const prompt = `Create a 7-day study plan for ${userContext.name}, CS student. Weak areas: ${userContext.weakTopics?.join(', ')||'DSA'}. Level ${userContext.level}.
Return ONLY JSON array, no markdown: [{"day":"MON","task":"description","duration_min":40},...]
Days: MON,TUE,WED,THU,FRI,SAT,SUN.`;
  const text = await callGroq({ messages: [{ role: 'user', content: prompt }], max_tokens: 600 });
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function generatePredictions({ userContext }) {
  const prompt = `CS student: Level ${userContext.level}, accuracy ${userContext.avgAccuracy}%, streak ${userContext.streak}d, DSA ${userContext.skills?.dsa||0}%.
Return ONLY JSON, no markdown: {"masterDSA":"X days","reachLevel15":"X days","top3Leaderboard":"X days","placementReady":"X days","insight":"actionable tip"}`;
  const text = await callGroq({ messages: [{ role: 'user', content: prompt }], max_tokens: 300 });
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

module.exports = { generateQuizQuestions, evaluateReverse, evaluateTeaching, mentorChat, generateStudyPlan, generatePredictions };
