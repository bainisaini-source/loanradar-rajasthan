/**
 * STEP 2 — ENRICH CONTACT DETAILS
 * ---------------------------------
 * Finds phone numbers for each business using:
 *   A) Justdial (India's largest business directory)
 *   B) IndiaMART (B2B platform with contact details)
 *   C) Google search (finds business websites with phone)
 *
 * Expected enrichment rate: 50-70% of leads will get a phone number.
 * Leads without phones are kept but scored lower.
 *
 * Output: data/enriched_leads.json
 */

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "../data");
const RAW_PATH = path.join(DATA_DIR, "raw_registrations.json");
const OUT_PATH = path.join(DATA_DIR, "enriched_leads.json");
const DELAY = 2500; // ms between requests — be polite

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function cleanPhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};

// ─── JUSTDIAL SEARCH ──────────────────────────────────────────────────────────

async function searchJustdial(businessName, city) {
  try {
    // Justdial search URL
    const query = encodeURIComponent(
      businessName.replace(/private limited|pvt ltd|llp|ltd/gi, "").trim()
    );
    const citySlug = city.toLowerCase().replace(/\s+/g, "-");

    const url = `https://www.justdial.com/${citySlug}/${query}`;

    const res = await axios.get(url, {
      headers: {
        ...HEADERS,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      },
      timeout: 12000,
    });

    const $ = cheerio.load(res.data);
    const text = res.data;

    // Pattern 1: data-phone attribute
    let phone = $("[data-phone]").first().attr("data-phone");

    // Pattern 2: tel: links
    if (!phone) {
      const telLink = $("a[href^='tel:']").first().attr("href");
      if (telLink) phone = telLink.replace("tel:", "");
    }

    // Pattern 3: Scan HTML for 10-digit Indian mobile numbers
    if (!phone) {
      const matches = text.match(/[6-9]\d{9}/g);
      if (matches) phone = matches[0];
    }

    // Owner name
    let ownerName = $(".owner-name, .contact-name, [class*=owner]").first().text().trim() || null;

    const cleaned = cleanPhone(phone);
    if (cleaned) {
      return { phone: cleaned, ownerName, source: "Justdial" };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── INDIAMART SEARCH ─────────────────────────────────────────────────────────

async function searchIndiaMART(businessName, city) {
  try {
    const name = businessName.replace(/private limited|pvt ltd|llp|ltd/gi, "").trim();
    const query = encodeURIComponent(`${name} ${city}`);
    const url = `https://dir.indiamart.com/search.mp?ss=${query}&src=ss-search`;

    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 12000,
    });

    const $ = cheerio.load(res.data);

    // IndiaMART contact patterns
    let phone =
      $("[data-contactnumber]").first().attr("data-contactnumber") ||
      $(".contact-detail .number, .pns .tel").first().text().trim();

    // Owner/contact name
    let ownerName =
      $(".contact-name, .uname, .seller-name").first().text().trim() || null;

    const cleaned = cleanPhone(phone);
    if (cleaned) {
      return { phone: cleaned, ownerName, source: "IndiaMART" };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── GOOGLE SEARCH ───────────────────────────────────────────────────────────

async function searchGoogle(businessName, city) {
  try {
    const query = encodeURIComponent(
      `"${businessName.replace(/private limited|pvt ltd/gi, "").trim()}" ${city} contact phone`
    );
    const url = `https://www.google.com/search?q=${query}&num=5`;

    const res = await axios.get(url, {
      headers: {
        ...HEADERS,
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
      timeout: 10000,
    });

    // Extract Indian phone numbers from results
    const phones = res.data.match(/[6-9]\d{9}/g);
    if (phones && phones.length > 0) {
      const cleaned = cleanPhone(phones[0]);
      if (cleaned) return { phone: cleaned, ownerName: null, source: "Google" };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── BUSINESS CLASSIFIER ─────────────────────────────────────────────────────
//
// Maps business name keywords to loan-relevant categories
// Used by Step 3 for scoring and insights

function classifyBusiness(name) {
  const n = name.toLowerCase();

  if (/textile|fabric|garment|cloth|saree|suit|weav/.test(n))
    return { type: "Textile / Wholesale", loanRange: "₹5–15L", urgency: "high" };
  if (/construct|infra|build|civil|cement|engineer/.test(n))
    return { type: "Construction / Infra", loanRange: "₹20–50L", urgency: "high" };
  if (/pharma|medical|health|hospital|clinic|drug|medicine/.test(n))
    return { type: "Pharma / Medical", loanRange: "₹8–20L", urgency: "high" };
  if (/food|restaurant|hotel|catering|sweet|bakery|dhaba|cafe/.test(n))
    return { type: "Food & Beverage", loanRange: "₹2–8L", urgency: "medium" };
  if (/auto|vehicle|motor|bike|car|tyre|garage|spare/.test(n))
    return { type: "Automobile / Auto Parts", loanRange: "₹5–12L", urgency: "medium" };
  if (/software|tech|digital|computer|web|app|it |information/.test(n))
    return { type: "IT / Technology", loanRange: "₹2–6L", urgency: "medium" };
  if (/agri|farm|seed|fertilizer|crop|kisan|harvest/.test(n))
    return { type: "Agriculture / Agri-inputs", loanRange: "₹3–10L", urgency: "high" };
  if (/jewel|gold|silver|gems|ornament/.test(n))
    return { type: "Jewellery / Gems", loanRange: "₹10–30L", urgency: "high" };
  if (/manuf|factor|industri|production|process/.test(n))
    return { type: "Manufacturing", loanRange: "₹15–40L", urgency: "high" };
  if (/trading|trade|import|export|wholesale|distribut/.test(n))
    return { type: "Trading / Wholesale", loanRange: "₹5–20L", urgency: "high" };
  if (/retail|shop|store|mart|kirana|supermarket/.test(n))
    return { type: "Retail", loanRange: "₹2–6L", urgency: "medium" };
  if (/transport|logistic|courier|cargo|freight|movers/.test(n))
    return { type: "Transport / Logistics", loanRange: "₹5–15L", urgency: "medium" };
  if (/consult|service|solution|advisor|management/.test(n))
    return { type: "Consulting / Services", loanRange: "₹1–4L", urgency: "low" };
  if (/real.?estate|property|realty|housing|developer/.test(n))
    return { type: "Real Estate", loanRange: "₹20–50L", urgency: "high" };

  return { type: "General Business", loanRange: "₹3–10L", urgency: "medium" };
}

// ─── MAIN ENRICHMENT LOOP ─────────────────────────────────────────────────────

async function main() {
  log("═══════════════════════════════════════════════");
  log("LOANRADAR — Step 2: Enrich Contact Details");
  log("═══════════════════════════════════════════════");

  if (!fs.existsSync(RAW_PATH)) {
    log("ERROR: data/raw_registrations.json not found. Run Step 1 first.");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
  const registrations = raw.registrations || [];
  log(`Processing ${registrations.length} registrations...`);

  const enriched = [];

  for (let i = 0; i < registrations.length; i++) {
    const biz = registrations[i];
    log(`\n[${i + 1}/${registrations.length}] ${biz.name} | ${biz.city}`);

    // Classify business type
    const cls = classifyBusiness(biz.name);

    let contact = null;

    // Try Justdial first (best for small businesses)
    contact = await searchJustdial(biz.name, biz.city);
    if (contact) {
      log(`   ✓ Phone via Justdial: ${contact.phone}`);
    }
    await sleep(DELAY);

    // Try IndiaMART if Justdial failed (good for traders/manufacturers)
    if (!contact) {
      contact = await searchIndiaMART(biz.name, biz.city);
      if (contact) log(`   ✓ Phone via IndiaMART: ${contact.phone}`);
      await sleep(DELAY);
    }

    // Try Google as last resort
    if (!contact) {
      contact = await searchGoogle(biz.name, biz.city);
      if (contact) log(`   ✓ Phone via Google: ${contact.phone}`);
      await sleep(DELAY);
    }

    if (!contact) {
      log(`   — No phone found`);
    }

    // Determine best owner name to use
    const ownerName =
      contact?.ownerName ||
      biz.directorName ||
      (biz.allDirectors && biz.allDirectors[0]) ||
      null;

    enriched.push({
      ...biz,
      ownerName,
      phone: contact?.phone || null,
      phoneSource: contact?.source || null,
      contactFound: !!(contact?.phone),
      businessType: cls.type,
      estimatedLoanRange: cls.loanRange,
      urgencySignal: cls.urgency,
    });
  }

  const found = enriched.filter(e => e.contactFound).length;
  log(`\n✓ Enrichment done: ${found}/${enriched.length} phones found (${Math.round(found/enriched.length*100)}%)`);

  fs.writeFileSync(OUT_PATH, JSON.stringify({
    enrichedAt: new Date().toISOString(),
    totalLeads: enriched.length,
    phonesFound: found,
    leads: enriched,
  }, null, 2));

  log(`✓ Saved → data/enriched_leads.json`);
  log("→ Run Step 3: node scripts/3_score_and_rank.js");
}

main().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
