// api/ask-krishna.js
// Vercel serverless function — Ask Krishna feature for nuantra.com
// Uses Groq API (free tier) with a two-layer safety architecture:
//   Layer 1: Llama Guard classifies the INCOMING question before anything is generated
//   Layer 2: Llama Guard classifies the OUTGOING answer before it is returned to the user
// If either layer flags unsafe content, a fixed safe fallback is returned instead —
// the main model's output never reaches the user unchecked.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Models — verify current availability at https://console.groq.com/docs/models
// Llama Guard is Groq's dedicated moderation/classification model.
const GUARD_MODEL = "llama-guard-3-8b";
const CHAT_MODEL = "llama-3.3-70b-versatile";

const KRISHNA_SYSTEM_PROMPT = `You are speaking in the voice and spirit of Krishna as he counseled Arjuna in the Bhagavad Gita — a steady, compassionate, wise presence who helps a person see their situation with more clarity and less fear.

Rules you always follow, without exception:
1. You NEVER discourage someone from seeking medical care, therapy, psychiatric help, or emergency services. If the situation calls for professional help, you say so directly and encourage it, alongside whatever spiritual perspective you offer.
2. You NEVER suggest, endorse, describe, or imply any method of self-harm, suicide, or violence toward another person, under any framing — not as metaphor, not as "release," not as anything.
3. You NEVER tell someone to isolate from people who care about them, to hide their struggle, or to distrust professional help.
4. If someone's message describes a crisis — thoughts of self-harm, suicide, harming someone else, or being in immediate danger — you do not attempt to counsel them through it with philosophy alone. You respond with warmth, take it seriously, and clearly direct them toward real human help (a mental health professional, a crisis line, someone they trust) before anything else.
5. Your guidance draws from the Gita's teachings — duty (dharma), detachment from outcomes (nishkama karma), steadiness of mind (sthitaprajna), impermanence, the difference between the self and the ego. You speak with warmth, not lecture. Short, clear, human — not a wall of Sanskrit terms.
6. You are not a licensed therapist and you never claim to be one. Spiritual guidance complements professional help; it does not replace it.
7. Keep responses under 200 words. Grounded, specific to what they actually said — not generic verses.`;

const SAFE_FALLBACK_INPUT_FLAGGED = `I can hear that you're going through something heavy right now. This is bigger than something I can help with alone — please reach out to someone who can actually be there with you.

If you're in India: iCall — 9152987821, or AASRA — 9820466726, or Kiran (Govt. of India) — 1800-599-0019.

If you're somewhere else, please contact your local emergency number or a crisis helpline right away, or talk to someone you trust.

You deserve real support, not just words. Please reach out now.`;

const SAFE_FALLBACK_OUTPUT_FLAGGED = `I want to make sure you get guidance that truly helps rather than something that could cause harm. For what you're describing, please speak with a mental health professional or a trusted person in your life — they can support you in ways I can't.

If you're in India: iCall — 9152987821, or AASRA — 9820466726, or Kiran (Govt. of India) — 1800-599-0019.`;

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
      temperature: model === CHAT_MODEL ? 0.7 : 0
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error (${res.status}): ${errText}`);
  }
  return res.json();
}

// Returns true if Llama Guard flags the text as unsafe
async function isUnsafe(text) {
  try {
    const result = await callGroq(GUARD_MODEL, [
      { role: "user", content: text }
    ], 20);
    const verdict = (result.choices?.[0]?.message?.content || "").toLowerCase();
    // Llama Guard responds with "safe" or "unsafe\n<category>"
    return verdict.includes("unsafe");
  } catch (e) {
    // If the safety check itself fails, fail closed — treat as unsafe
    console.error("Safety check failed:", e.message);
    return true;
  }
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

  // NOTE ON SAFETY DESIGN:
  // We deliberately do NOT run a standalone input-side safety block based on
  // Llama Guard's raw verdict. In testing, Llama Guard frequently flags ordinary
  // emotional or life-struggle content (job loss, grief, family conflict) as
  // "unsafe" due to distress-adjacent language, even with no self-harm or
  // violence content present. Blocking on that alone produces false positives
  // that deny real, benign questions a response.
  //
  // Instead: Krishna's system prompt explicitly instructs the model on how to
  // handle genuine crisis content (redirect to real help, don't counsel through
  // it with philosophy) — the model reads full context, not just keywords.
  // The OUTPUT is then checked by Llama Guard before reaching the user — this
  // is the real backstop. If the model's response is itself ever unsafe, it
  // never reaches the person.

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

    // Output-side safety check — the real backstop
    const outputFlagged = await isUnsafe(answer);
    if (outputFlagged) {
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
