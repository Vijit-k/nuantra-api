// api/ask-krishna.js
// Vercel serverless function — Ask Krishna feature for nuantra.com
// Uses Groq API (free tier) for generation.
//
// SAFETY DESIGN:
// Krishna's system prompt is the primary safeguard — it explicitly instructs
// the model on how to handle crisis content (redirect to real help, never
// counsel through it with philosophy alone, never discourage medical care,
// never suggest self-harm or violence).
//
// A deterministic keyword-based check then scans the OUTPUT text as a
// backstop, looking for a narrow, specific list of genuinely dangerous
// patterns. This replaced an earlier Llama-Guard-based classifier, which in
// testing repeatedly flagged ordinary supportive content (e.g. encouragement
// through unemployment/job loss) as unsafe — false positives that blocked
// legitimate, benign responses. A keyword check on explicit dangerous
// patterns is more predictable and auditable than a black-box classifier
// that was misfiring on this content.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CHAT_MODEL = "llama-3.3-70b-versatile";

const KRISHNA_SYSTEM_PROMPT = `You are speaking in the voice and spirit of Krishna as he counseled Arjuna in the Bhagavad Gita — a steady, compassionate, wise presence who helps a person see their situation with more clarity and less fear.

Rules you always follow, without exception:
1. You NEVER discourage someone from seeking medical care, therapy, psychiatric help, or emergency services. If the situation calls for professional help, you say so directly and encourage it, alongside whatever spiritual perspective you offer.
2. You NEVER suggest, endorse, describe, or imply any method of self-harm, suicide, or violence toward another person, under any framing — not as metaphor, not as "release," not as anything.
3. You NEVER tell someone to isolate from people who care about them, to hide their struggle, or to distrust professional help.
4. If someone's message describes a crisis — thoughts of self-harm, suicide, harming someone else, or being in immediate danger — you do not attempt to counsel them through it with philosophy alone. You respond with warmth, take it seriously, and clearly direct them toward real human help (a mental health professional, a crisis line, someone they trust) before anything else.
5. Your guidance draws from the Gita's teachings — duty (dharma), detachment from outcomes (nishkama karma), steadiness of mind (sthitaprajna), impermanence, the difference between the self and the ego. You speak with warmth, not lecture. Short, clear, human — not a wall of Sanskrit terms.
6. You are not a licensed therapist and you never claim to be one. Spiritual guidance complements professional help; it does not replace it.
7. Keep responses under 200 words. Grounded, specific to what they actually said — not generic verses.
8. Ordinary life struggles — job loss, career uncertainty, family pressure, financial stress, relationship conflict, self-doubt — are NOT crises. Respond to these with genuine Gita-rooted encouragement and perspective, not a redirect to helplines. Only redirect to professional/crisis help when the person describes actual thoughts of self-harm, suicide, or harming someone else.`;

const SAFE_FALLBACK_OUTPUT_FLAGGED = `I want to make sure you get guidance that truly helps rather than something that could cause harm. For what you're describing, please speak with a mental health professional or a trusted person in your life — they can support you in ways I can't.

If you're in India: iCall — 9152987821, or AASRA — 9820466726, or Kiran (Govt. of India) — 1800-599-0019.`;

// Narrow, explicit list of genuinely dangerous patterns.
// This is intentionally conservative — it should only catch clear, unambiguous
// instances of harmful instruction, not emotional language or distress themes.
const DANGEROUS_PATTERNS = [
  /don'?t (see|go to|visit|consult) a (doctor|therapist|psychiatrist|professional)/i,
  /no need (for|to see) (a doctor|therapy|professional help|medical)/i,
  /(cut|hurt|harm) yourself/i,
  /take (all|a lot of|handful of) (pills|medication|tablets)/i,
  /(way|method|how) to (kill|end your life|take your (own )?life)/i,
  /you should (kill|hurt|harm) (them|him|her|someone)/i,
  /stop taking (your|the) medication/i,
  /isolate (yourself )?from (everyone|family|friends|people who care)/i,
];

function containsDangerousPattern(text) {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(text));
}

async function callGroq(model, messages, maxTokens) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + process.env.GROQ_API_KEY
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error (${res.status}): ${errText}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://nuantra.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { question } = req.body || {};

  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "A question is required." });
  }
  if (question.length > 1500) {
    return res.status(400).json({ error: "Question is too long." });
  }

  try {
    const completion = await callGroq(CHAT_MODEL, [
      { role: "system", content: KRISHNA_SYSTEM_PROMPT },
      { role: "user", content: question }
    ], 400);

    const answer = completion.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return res.status(200).json({
        answer: "I could not form a response just now. Please try asking again.",
        flagged: false
      });
    }

    // Deterministic backstop check on the actual output text
    if (containsDangerousPattern(answer)) {
      console.warn("Dangerous pattern matched in output — serving fallback.");
      return res.status(200).json({
        answer: SAFE_FALLBACK_OUTPUT_FLAGGED,
        flagged: true
      });
    }

    return res.status(200).json({ answer, flagged: false });

  } catch (err) {
    console.error("Ask Krishna error:", err.message);
    return res.status(500).json({
      answer: "Something went wrong on my end. Please try again in a moment.",
      error: true
    });
  }
}
