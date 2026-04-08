/* ===================================================
   SatyaCHECK — app.js (Netlify Function Enabled)
=================================================== */

// Active language for input (EN/HI/OD/BN)
let activeInputLang = "English";
// Cached result for translation
let lastResult = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("claimInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) checkFact();
  });

  // Update timestamp in header
  const ts = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("resultTimestamp").textContent = `satyacheck — ${ts}`;
});

// ─── Language Selector (Input) ─────────────────────────────────────────────
function setLang(lang, btn) {
  activeInputLang = lang;
  document.querySelectorAll(".lang-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

// ─── Reset UI ─────────────────────────────────────────────────────────────────
function resetCheck() {
  document.getElementById("resultCard").classList.add("hidden");
  document.getElementById("errorCard").classList.add("hidden");
  document.getElementById("claimInput").value = "";
  lastResult = null;
  document.getElementById("claimInput").focus();
}

// ─── Main: Check Fact ─────────────────────────────────────────────────────────
async function checkFact() {
  const claim = document.getElementById("claimInput").value.trim();

  document.getElementById("resultCard").classList.add("hidden");
  document.getElementById("errorCard").classList.add("hidden");

  if (!claim) { 
    showError("Please enter a claim or message to fact-check."); 
    return; 
  }

  setLoading(true);

  try {
    const result = await fetchFactCheck(claim);
    lastResult = result;
    renderResult(result);
  } catch (err) {
    console.error("[SatyaCHECK]", err);
    showError(err.message || "Something went wrong communicating with the server.");
  } finally {
    setLoading(false);
  }
}

// ─── Step 1: Fact-check via Groq (English JSON — most reliable) ───────────────
async function fetchFactCheck(claim) {
  const system = `You are SatyaCHECK, a professional fact-checking AI.
Analyze the claim and return ONLY a raw JSON object — no markdown, no code fences, nothing outside the JSON.

Format (use exactly this):
{
  "verdict": "TRUE",
  "title": "One-line verdict summary in English",
  "explanation": "2-3 sentence concise explanation in English",
  "score": 85,
  "keyPoints": ["Concise factual point 1", "Concise factual point 2", "Concise factual point 3"],
  "sources": ["WHO Guidelines", "Reuters Fact Check", "PubMed Study 2023"]
}

Rules:
- verdict: exactly one of TRUE / FALSE / MISLEADING / UNVERIFIABLE
- score: integer 0-100 (credibility score; 0=completely false, 100=completely verified)
- keyPoints: 2-4 concise English bullet points
- sources: 2-4 credible reference types (e.g. "WHO", "Reuters", "AIIMS Study")
- All strings must be valid JSON (no raw newlines, properly escaped)
- DO NOT add text before or after the JSON`;

  const data = await groqProxyFetch([
    { role: "system", content: system },
    { role: "user",   content: `Fact-check this claim: "${claim}"` }
  ], 0.1, 600);

  const raw = data.choices[0]?.message?.content || "";
  console.log("[SatyaCHECK] Raw:", raw);
  return robustParseJSON(raw);
}

// ─── Step 2: Translate Output (on demand) ────────────────────────────────────
async function translateOutput(lang) {
  if (!lastResult) return;

  // Mark active
  document.querySelectorAll(".trans-btn").forEach(b => b.classList.remove("active"));
  const activeBtn = document.getElementById(`trans-${lang}`);
  if (activeBtn) activeBtn.classList.add("active");

  const output = document.getElementById("transOutput");

  if (lang === "English") {
    // Just re-render original English
    renderTransOutput({
      explanation: lastResult.explanation,
      keyPoints:   lastResult.keyPoints
    });
    return;
  }

  output.classList.add("loading");
  output.textContent = `Translating to ${lang}…`;

  // Disable all trans buttons during load
  document.querySelectorAll(".trans-btn").forEach(b => b.disabled = true);

  try {
    const prompt = `Translate the following into ${lang}. Return ONLY a raw JSON object with NO markdown or extra text.

Format:
{"explanation":"<translated explanation>","keyPoints":["<point 1>","<point 2>","<point 3>"]}

explanation: ${lastResult.explanation}
keyPoints: ${JSON.stringify(lastResult.keyPoints)}`;

    const data = await groqProxyFetch([
      { role: "user", content: prompt }
    ], 0.1, 400);

    const raw = data.choices[0]?.message?.content || "";
    console.log("[SatyaCHECK] Translation:", raw);

    const translated = robustParseJSON(raw);
    renderTransOutput({
      explanation: translated.explanation || lastResult.explanation,
      keyPoints:   Array.isArray(translated.keyPoints) && translated.keyPoints.length > 0
                     ? translated.keyPoints : lastResult.keyPoints
    });
  } catch (e) {
    output.classList.remove("loading");
    output.textContent = "Translation failed. Please try again.";
    console.warn("[SatyaCHECK] Translation error:", e);
  } finally {
    document.querySelectorAll(".trans-btn").forEach(b => b.disabled = false);
    if (activeBtn) activeBtn.classList.add("active");
  }
}

function renderTransOutput({ explanation, keyPoints }) {
  const output = document.getElementById("transOutput");
  output.classList.remove("loading");
  output.innerHTML = "";

  const expEl = document.createElement("div");
  expEl.className = "trans-explanation";
  expEl.textContent = explanation;
  output.appendChild(expEl);

  if (Array.isArray(keyPoints) && keyPoints.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "trans-points";
    keyPoints.forEach(pt => {
      const li = document.createElement("li");
      li.textContent = pt;
      ul.appendChild(li);
    });
    output.appendChild(ul);
  }
}

// ─── Render Result ────────────────────────────────────────────────────────────
function renderResult(data) {
  const verdict     = (data.verdict || "UNVERIFIABLE").toUpperCase();
  const title       = data.title || "Verdict";
  const explanation = data.explanation || "No explanation available.";
  const score       = parseInt(data.score) || 50;
  const keyPoints   = Array.isArray(data.keyPoints) ? data.keyPoints : [];
  const sources     = Array.isArray(data.sources)   ? data.sources   : [];

  const badge = document.getElementById("verdictBadge");
  badge.className = "verdict-badge";
  let emoji = "🔍"; let badgeClass = "badge-unknown"; let blockClass = "info";

  if (verdict === "TRUE")         { emoji = "✅"; badgeClass = "badge-verified";   blockClass = "ok"; }
  else if (verdict === "FALSE")   { emoji = "❌"; badgeClass = "badge-misleading"; blockClass = "danger"; }
  else if (verdict === "MISLEADING") { emoji = "⚠️"; badgeClass = "badge-context"; blockClass = "warn"; }

  badge.classList.add(badgeClass);
  badge.textContent = `${emoji} ${verdict}`;

  document.getElementById("verdictTitle").textContent = title;

  const scoreNum = document.getElementById("scoreNumber");
  const scoreBar = document.getElementById("scoreBar");
  const level    = score >= 65 ? "high" : score >= 35 ? "mid" : "low";

  scoreNum.textContent = score;
  scoreNum.className   = `score-number ${level}`;
  scoreBar.className   = `score-bar-fill ${level}`;
  setTimeout(() => { scoreBar.style.width = `${score}%`; }, 80);

  const expBlock = document.getElementById("explanationBlock");
  expBlock.className = `claim-block ${blockClass}`;
  expBlock.textContent = explanation;

  const kpSection = document.getElementById("keyPointsSection");
  const kpList    = document.getElementById("keyPointsList");
  kpList.innerHTML = "";
  if (keyPoints.length > 0) {
    keyPoints.forEach((pt, i) => {
      const cls = i === 0 ? blockClass : "info";
      const div = document.createElement("div");
      div.className = `claim-block ${cls}`;
      div.textContent = pt;
      kpList.appendChild(div);
    });
    kpSection.style.display = "block";
  } else {
    kpSection.style.display = "none";
  }

  const srcSection = document.getElementById("sourcesSection");
  const srcGrid    = document.getElementById("sourcesGrid");
  srcGrid.innerHTML = "";
  if (sources.length > 0) {
    const dotMap = { TRUE: "ok", FALSE: "bad", MISLEADING: "mid" };
    const dotClass = dotMap[verdict] || "mid";
    sources.forEach(src => {
      const chip = document.createElement("div");
      chip.className = "source-chip";
      chip.innerHTML = `<div class="source-dot ${dotClass}"></div><span>${src}</span>`;
      srcGrid.appendChild(chip);
    });
    srcSection.style.display = "block";
  } else {
    srcSection.style.display = "none";
  }

  document.querySelectorAll(".trans-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("transOutput").innerHTML =
    `<span style="color:var(--text-muted);font-style:italic;font-size:13px;">Select a language above to translate this result.</span>`;

  const card = document.getElementById("resultCard");
  card.classList.remove("hidden");
  card.scrollIntoView({ behavior: "smooth", block: "start" });

  const ts = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  document.getElementById("resultTimestamp").textContent = `satyacheck — ${ts}`;
}

// ─── Error Display ────────────────────────────────────────────────────────────
function showError(msg) {
  document.getElementById("errorMsg").textContent = msg;
  document.getElementById("errorCard").classList.remove("hidden");
  document.getElementById("errorCard").scrollIntoView({ behavior: "smooth" });
}

// ─── Loading State ────────────────────────────────────────────────────────────
function setLoading(on) {
  const btn  = document.getElementById("checkBtn");
  btn.disabled = on;
  document.getElementById("btnText").classList.toggle("hidden", on);
  document.getElementById("btnLoader").classList.toggle("hidden", !on);
}

// ─── Netlify Proxy Fetch ──────────────────────────────────────────────────────
async function groqProxyFetch(messages, temperature = 0.1, maxTokens = 600) {
  // Pointing to our Netlify Serverless Function
  const res = await fetch("/.netlify/functions/groq", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, temperature, maxTokens })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.json();
}

// ─── Robust JSON Parser (6-layer fallback) ────────────────────────────────────
function robustParseJSON(raw) {
  let c = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try { return JSON.parse(c); } catch (_) {}
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  if (s !== -1 && e > s) {
    const slice = c.slice(s, e + 1);
    try { return JSON.parse(slice); } catch (_) {}
    const fixed = slice
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\n/g, " ").replace(/\r/g, "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    try { return JSON.parse(fixed); } catch (_) {}
  }
  const str = (f) => {
    const m = raw.match(new RegExp(`"${f}"\\s*:\\s*"((?:[^"\\\\]|\\\\[\\s\\S])*)"`, "s"));
    return m ? m[1].replace(/\\n/g, " ") : null;
  };
  const arr = (f) => {
    const m = raw.match(new RegExp(`"${f}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) return [];
    return [...m[1].matchAll(/"((?:[^"\\\\]|\\\\[\\s\\S])*)"/g)].map(x => x[1].replace(/\\n/g, " "));
  };
  const num = (f) => {
    const m = raw.match(new RegExp(`"${f}"\\s*:\\s*(\\d+)`));
    return m ? parseInt(m[1]) : null;
  };

  const verdict = str("verdict");
  if (verdict) {
    return {
      verdict: verdict.toUpperCase(),
      title:   str("title") || "Analysis complete",
      explanation: str("explanation") || raw.replace(/[{}":\[\]\\]/g, " ").trim().slice(0, 400),
      score:   num("score") || 50,
      keyPoints: arr("keyPoints"),
      sources:   arr("sources")
    };
  }
  const up = raw.toUpperCase();
  let v = "UNVERIFIABLE";
  if (up.includes("FALSE") || up.includes("FAKE"))        v = "FALSE";
  else if (up.includes("TRUE") || up.includes("CORRECT")) v = "TRUE";
  else if (up.includes("MISLEAD"))                         v = "MISLEADING";

  return {
    verdict: v, title: "Analysis Complete",
    explanation: raw.replace(/[{}":\[\]\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
    score: 50, keyPoints: [], sources: []
  };
}
