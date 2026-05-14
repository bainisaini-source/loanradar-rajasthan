/**
 * STEP 3 — SCORE, RANK & GENERATE INSIGHTS
 * ------------------------------------------
 * Scores every lead 1-10, picks top 10, generates call scripts.
 * Uses Claude AI if API key is set, otherwise uses smart rule-based insights.
 * Output: data/leads_today.json (read by dashboard)
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const DATA_DIR = path.join(__dirname, "../data");
const ENRICHED_PATH = path.join(DATA_DIR, "enriched_leads.json");
const OUTPUT_PATH = path.join(DATA_DIR, "leads_today.json");
const DAILY_TARGET = parseInt(process.env.DAILY_LEAD_TARGET || "10");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── SCORING ─────────────────────────────────────────────────────────────────

function parseDaysOld(registeredAgo) {
  if (!registeredAgo) return 999;
  if (/today/i.test(registeredAgo)) return 0;
  const m = registeredAgo.match(/(\d+)\s+day/);
  return m ? parseInt(m[1]) : 999;
}

function scoreLead(lead) {
  let score = 0;
  const reasons = [];

  // Signal source (max 2)
  if (lead.source === "MCA + GST") {
    score += 2; reasons.push("Found in both MCA + GST");
  } else {
    score += 1.5; reasons.push(`Found in ${lead.source}`);
  }

  // Registration freshness (max 3)
  const days = parseDaysOld(lead.registeredAgo);
  if (days <= 2)       { score += 3; reasons.push(`Very fresh — ${lead.registeredAgo}`); }
  else if (days <= 4)  { score += 2; reasons.push(`Recent — ${lead.registeredAgo}`); }
  else                 { score += 1; reasons.push(`Registered ${lead.registeredAgo}`); }

  // Business urgency (max 2)
  if (lead.urgencySignal === "high")        { score += 2; reasons.push(`${lead.businessType} = high capital need`); }
  else if (lead.urgencySignal === "medium") { score += 1; reasons.push(`${lead.businessType} = moderate capital need`); }

  // Phone available (max 1.5)
  if (lead.contactFound && lead.phone) {
    score += 1.5; reasons.push("Phone found — ready to call");
  } else {
    score -= 0.5; reasons.push("No phone — needs manual lookup");
  }

  // Director name known (max 0.5)
  if (lead.ownerName) {
    score += 0.5; reasons.push(`Director known: ${lead.ownerName}`);
  }

  // Company type bonus
  const ct = (lead.companyType || "").toUpperCase();
  if (ct.includes("PRIVATE") || ct.includes("PVT")) score += 0.3;

  score = Math.max(1, Math.min(10, Math.round(score)));
  const tier = score >= 7 ? "hot" : score >= 4 ? "warm" : "cold";
  return { score, tier, reasons };
}

// ─── AI INSIGHT (Claude API) ──────────────────────────────────────────────────

function callClaudeAPI(prompt) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    });

    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.content?.[0]?.text?.trim() || null);
        } catch { resolve(null); }
      });
    });

    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function generateInsight(lead, useAI) {
  if (useAI) {
    const prompt = `You are a loan agent assistant in India. Write ONE short paragraph (max 40 words) for a call agent about this lead:
Business: ${lead.name}, ${lead.city}, Rajasthan
Type: ${lead.businessType}
Registered: ${lead.registeredAgo}
Estimated loan: ${lead.estimatedLoanRange}
Tell the agent: why this business needs a loan now, and what to say on the call. Be specific and practical.`;

    const aiText = await callClaudeAPI(prompt);
    if (aiText) return aiText;
  }

  // Rule-based fallback
  const age = lead.registeredAgo || "recently";
  const range = lead.estimatedLoanRange;
  const type = lead.businessType;
  const city = lead.city;

  const scripts = {
    "Textile / Wholesale": `New textile business in ${city}, registered ${age}. Working capital needed immediately for stock procurement and supplier payments. Pitch ${range} — ask about their first stock order.`,
    "Construction / Infra": `Construction company registered ${age} in ${city}. Project financing needed before first contract begins. Pitch ${range} term loan — ask about their upcoming project timeline.`,
    "Manufacturing": `New manufacturing unit in ${city}, ${age}. Machinery and raw material costs are immediate. Pitch ${range} — ask if equipment purchase is planned this month.`,
    "Pharma / Medical": `Pharma distributor in ${city}, registered ${age}. Drug stock requires large upfront capital with 45-day credit cycles. Pitch ${range} inventory loan.`,
    "Trading / Wholesale": `Trading business registered ${age} in ${city}. Stock procurement capital is needed from day one. Pitch ${range} working capital loan — decision maker is the founder.`,
    "Real Estate": `Real estate company registered ${age} in ${city}. Project development capital needed immediately. Pitch ${range} — ask about their first project scope.`,
    "Food & Beverage": `Food business registered ${age} in ${city}. Equipment, interiors, and initial stock costs are immediate. Pitch ${range} — owner is likely the decision maker.`,
    "Jewellery / Gems": `Jewellery business in ${city}, registered ${age}. Gold stock requires significant upfront capital. Pitch ${range} — this is a high-value, high-intent lead.`,
  };

  return scripts[type] ||
    `New ${type.toLowerCase()} in ${city}, registered ${age}. Capital requirement is likely immediate at setup stage. Pitch ${range} business loan — ask what their biggest startup cost is.`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log("═══════════════════════════════════════════════");
  log("LOANRADAR — Step 3: Score, Rank & Insights");
  log("═══════════════════════════════════════════════");

  if (!fs.existsSync(ENRICHED_PATH)) {
    log("ERROR: enriched_leads.json not found. Run Step 2 first.");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(ENRICHED_PATH, "utf8"));
  const leads = data.leads || [];
  log(`Scoring ${leads.length} leads...`);

  // Score all leads
  const scored = leads.map(lead => {
    const { score, tier, reasons } = scoreLead(lead);
    return { ...lead, score, tier, scoreReasons: reasons };
  });

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Pick top N
  const top = scored.slice(0, DAILY_TARGET);
  log(`Selected top ${top.length} leads`);

  // Generate insights
  const useAI = !!process.env.ANTHROPIC_API_KEY;
  log(`Generating insights (${useAI ? "Claude AI" : "rule-based"})...`);

  for (let i = 0; i < top.length; i++) {
    log(`  [${i + 1}/${top.length}] ${top[i].name}`);
    top[i].aiInsight = await generateInsight(top[i], useAI);
    if (useAI) await new Promise(r => setTimeout(r, 400));
  }

  // Build final dashboard-ready output
  const dashLeads = top.map((lead, idx) => ({
    id: idx + 1,
    name: lead.name,
    businessType: lead.businessType,
    city: lead.city,
    source: lead.source,
    registeredAgo: lead.registeredAgo,
    score: lead.score,
    tier: lead.tier,
    ownerName: lead.ownerName || null,
    phone: lead.phone || null,
    phoneAvailable: !!lead.phone,
    email: lead.email || null,
    gstin: lead.gstin || null,
    cin: lead.cin || null,
    estimatedLoanRange: lead.estimatedLoanRange,
    loanType: lead.urgencySignal === "high" ? "Business Loan" : "Business / Personal Loan",
    aiInsight: lead.aiInsight,
    scoreReasons: lead.scoreReasons,
    called: false,
    notes: "",
  }));

  const today = new Date().toISOString().split("T")[0];
  const output = {
    date: today,
    generatedAt: new Date().toISOString(),
    totalScanned: leads.length,
    totalSelected: dashLeads.length,
    hotLeads: dashLeads.filter(l => l.tier === "hot").length,
    warmLeads: dashLeads.filter(l => l.tier === "warm").length,
    coldLeads: dashLeads.filter(l => l.tier === "cold").length,
    phonesFound: dashLeads.filter(l => l.phoneAvailable).length,
    insightMethod: useAI ? "Claude AI" : "rule-based",
    leads: dashLeads,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  // Save run log
  const logEntry = {
    date: today,
    scanned: leads.length,
    selected: dashLeads.length,
    hot: output.hotLeads,
    warm: output.warmLeads,
    phones: output.phonesFound,
    ranAt: new Date().toISOString(),
  };
  const logPath = path.join(DATA_DIR, "run_log.json");
  let runHistory = [];
  if (fs.existsSync(logPath)) {
    try { runHistory = JSON.parse(fs.readFileSync(logPath, "utf8")); } catch {}
  }
  runHistory.unshift(logEntry);
  runHistory = runHistory.slice(0, 30); // keep last 30 days
  fs.writeFileSync(logPath, JSON.stringify(runHistory, null, 2));

  log("\n═══════════════════════════════════════════════");
  log(`✓ TODAY'S ${dashLeads.length} LEADS READY`);
  log(`  🔥 Hot:  ${output.hotLeads}`);
  log(`  ★  Warm: ${output.warmLeads}`);
  log(`  —  Cold: ${output.coldLeads}`);
  log(`  📞 Phones: ${output.phonesFound}/${dashLeads.length}`);
  log(`  🤖 Insights: ${output.insightMethod}`);
  log("═══════════════════════════════════════════════");
}

main().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
