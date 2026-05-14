/**
 * STEP 1 — FETCH NEW RAJASTHAN REGISTRATIONS
 * -------------------------------------------
 * Data source: companydetails.in + zaubacorp.com
 * Both aggregate MCA data freely, no login needed.
 * These sites are much more scraping-friendly than mca.gov.in directly.
 *
 * What we get per company (free):
 *   ✓ Company name
 *   ✓ CIN number
 *   ✓ City (Jaipur, Jodhpur etc)
 *   ✓ Incorporation date
 *   ✓ Director names (2-3 per company)
 *   ✓ Email address (many companies list it)
 *   ✓ Business activity type
 *   ✓ Company type (Pvt Ltd, LLP etc)
 *
 * Output: data/raw_registrations.json
 */

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const TARGET_CITIES = (
  process.env.TARGET_CITIES ||
  "Jaipur,Jodhpur,Kota,Udaipur,Ajmer,Bikaner,Alwar,Bharatpur,Sikar,Pali"
).split(",").map(c => c.trim().toLowerCase());

const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "7");
const DATA_DIR = path.join(__dirname, "../data");
const LOG_FILE = path.join(DATA_DIR, "run_log.json");

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function daysAgo(dateStr) {
  if (!dateStr) return "Unknown";
  let d;
  // Handle DD-MMM-YYYY (e.g. "26-APR-2024")
  if (/\d{2}-[A-Z]{3}-\d{4}/.test(dateStr)) {
    d = new Date(dateStr.replace(/-/g, " "));
  } else if (dateStr.includes("/")) {
    const [dd, mm, yyyy] = dateStr.split("/");
    d = new Date(`${yyyy}-${mm}-${dd}`);
  } else {
    d = new Date(dateStr);
  }
  if (isNaN(d)) return "Unknown";
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "1 day ago";
  return `${diff} days ago`;
}

function isWithinLookback(dateStr) {
  if (!dateStr) return false;
  let d;
  if (/\d{2}-[A-Z]{3}-\d{4}/.test(dateStr)) {
    d = new Date(dateStr.replace(/-/g, " "));
  } else if (dateStr.includes("/")) {
    const [dd, mm, yyyy] = dateStr.split("/");
    d = new Date(`${yyyy}-${mm}-${dd}`);
  } else {
    d = new Date(dateStr);
  }
  if (isNaN(d)) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  return d >= cutoff;
}

function isTargetCity(cityStr) {
  if (!cityStr) return false;
  const c = cityStr.toLowerCase();
  // Always include if no city filter
  if (TARGET_CITIES.length === 0) return true;
  return TARGET_CITIES.some(tc => c.includes(tc));
}

function titleCase(str) {
  return (str || "")
    .toLowerCase()
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
}

// Standard headers to avoid bot detection
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
};

// ─── SOURCE: companydetails.in ────────────────────────────────────────────────
//
// URL pattern for Rajasthan new companies:
// https://www.companydetails.in/state/rajasthan/year/2025/month/04
//
// Each listing page shows 20 companies with:
// - Name, CIN, date, city, director names, email
// This is the cleanest free source for our needs.

async function fetchFromCompanyDetails() {
  log("→ Fetching from companydetails.in (Rajasthan)...");
  const results = [];

  // Build list of year/month combos to check based on lookback
  const months = [];
  const now = new Date();
  for (let i = 0; i <= Math.ceil(LOOKBACK_DAYS / 28); i++) {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(now.getMonth() - i);
    months.push({
      year: d.getFullYear(),
      month: String(d.getMonth() + 1).padStart(2, "0"),
    });
  }

  for (const { year, month } of months) {
    log(`   Checking ${year}/${month}...`);

    // Fetch multiple pages per month
    for (let page = 1; page <= 5; page++) {
      try {
        const url = `https://www.companydetails.in/state/rajasthan/year/${year}/month/${month}/page/${page}`;
        const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
        const $ = cheerio.load(res.data);

        let found = 0;
        let tooOld = 0;

        // Each company is in a card/row — parse the listing
        $(".company-card, .company-item, article, .card, tr.company-row, .list-item").each((_, el) => {
          const text = $(el).text();
          const html = $(el).html() || "";

          // Extract incorporation date
          const dateMatch =
            text.match(/(\d{2}[-\/][A-Z]{3}[-\/]\d{4})/i) ||
            text.match(/(\d{2}[-\/]\d{2}[-\/]\d{4})/);
          const dateStr = dateMatch ? dateMatch[1].toUpperCase() : "";

          // Skip if outside lookback window
          if (dateStr && !isWithinLookback(dateStr)) {
            tooOld++;
            return;
          }

          // Extract city
          const cityMatch =
            text.match(/(?:Jaipur|Jodhpur|Kota|Udaipur|Ajmer|Bikaner|Alwar|Bharatpur|Sikar|Pali|Tonk|Barmer|Churu|Hanumangarh|Jhunjhunu|Nagaur|Sri Ganganagar|Sawai Madhopur|Dausa|Dholpur|Karauli|Baran|Bundi|Chittorgarh|Jhalawar|Pratapgarh|Rajsamand|Dungarpur|Banswara|Sirohi)/i);
          const city = cityMatch ? cityMatch[0] : "";

          if (!isTargetCity(city)) return;

          // Extract company name
          const nameEl = $(el).find("h2, h3, h4, .company-name, a.name, strong").first();
          const name = nameEl.text().trim() || $(el).find("a").first().text().trim();
          if (!name || name.length < 3) return;

          // Extract CIN
          const cinMatch = text.match(/[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}/);
          const cin = cinMatch ? cinMatch[0] : "";

          // Extract directors
          const directors = [];
          $(el).find(".director, .director-name, [class*=director]").each((_, d) => {
            const n = $(d).text().trim();
            if (n.length > 2) directors.push(titleCase(n));
          });
          // Also try text pattern for director names
          const dirMatches = text.match(/(?:Director|Partner|Promoter)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/g);
          if (dirMatches) {
            dirMatches.forEach(m => {
              const n = m.replace(/Director|Partner|Promoter|[:\s]/gi, "").trim();
              if (n.length > 3 && !directors.includes(n)) directors.push(titleCase(n));
            });
          }

          // Extract email
          const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
          const email = emailMatch ? emailMatch[0].toLowerCase() : null;

          // Extract company type
          const typeMatch = name.match(/(PRIVATE LIMITED|PUBLIC LIMITED|LLP|OPC|ONE PERSON)/i);
          const companyType = typeMatch ? typeMatch[0] : "PRIVATE LIMITED";

          results.push({
            source: "MCA",
            name: titleCase(name),
            cin: cin || "",
            city: titleCase(city) || "Rajasthan",
            state: "Rajasthan",
            registrationDate: dateStr,
            registeredAgo: daysAgo(dateStr),
            companyType,
            directorName: directors[0] || null,
            allDirectors: directors,
            email: email || null,
            gstin: null,
            phone: null,
          });
          found++;
        });

        log(`   Page ${page}: ${found} companies found, ${tooOld} too old`);

        // If all results on this page are too old, stop paginating
        if (tooOld > 10 && found === 0) {
          log(`   Stopping pagination — reached older records`);
          break;
        }

        // If no results at all, page doesn't exist
        if (found === 0 && tooOld === 0) break;

        await sleep(2000); // polite delay
      } catch (err) {
        if (err.response?.status === 404) break;
        log(`   Page ${page} error: ${err.message}`);
        break;
      }
    }

    await sleep(3000);
  }

  log(`   companydetails.in total: ${results.length} Rajasthan companies found`);
  return results;
}

// ─── SOURCE: Zaubacorp ────────────────────────────────────────────────────────
//
// Zaubacorp URL pattern:
// https://www.zaubacorp.com/company-list/p-1/rajasthan-state-companies
//
// Good backup source. Shows company cards with CIN, date, city.

async function fetchFromZaubacorp() {
  log("→ Fetching from zaubacorp.com (Rajasthan)...");
  const results = [];

  for (let page = 1; page <= 8; page++) {
    try {
      const url = `https://www.zaubacorp.com/company-list/p-${page}/rajasthan-state-companies`;
      const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(res.data);

      let found = 0;
      let tooOld = 0;

      // Zaubacorp company rows
      $("table tbody tr, .company_list tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 3) return;

        const name = $(cells[0]).text().trim();
        const cin = $(cells[1]).text().trim();
        const dateStr = $(cells[2]).text().trim().toUpperCase();
        const statusText = $(cells[3] || cells[2]).text().trim();

        if (!name || name.length < 3) return;

        // Filter by date
        if (dateStr && !isWithinLookback(dateStr)) {
          tooOld++;
          return;
        }

        // Filter by state — Rajasthan CINs contain "RJ"
        if (cin && !cin.includes("RJ")) return;

        // Extract city from name or address column
        const allText = $(row).text();
        const cityMatch = allText.match(
          /(?:Jaipur|Jodhpur|Kota|Udaipur|Ajmer|Bikaner|Alwar|Bharatpur|Sikar|Pali)/i
        );
        const city = cityMatch ? cityMatch[0] : "Rajasthan";

        if (!isTargetCity(city)) return;

        results.push({
          source: "MCA",
          name: titleCase(name),
          cin: cin || "",
          city: titleCase(city),
          state: "Rajasthan",
          registrationDate: dateStr,
          registeredAgo: daysAgo(dateStr),
          companyType: name.includes("LLP") ? "LLP" : "PRIVATE LIMITED",
          directorName: null,
          email: null,
          gstin: null,
          phone: null,
        });
        found++;
      });

      log(`   Zaubacorp page ${page}: ${found} found, ${tooOld} too old`);

      if (tooOld > 5 && found === 0) {
        log("   Reached older records, stopping");
        break;
      }
      if (found === 0 && tooOld === 0) break;

      await sleep(2500);
    } catch (err) {
      if (err.response?.status === 404) break;
      log(`   Zaubacorp page ${page} error: ${err.message}`);
      break;
    }
  }

  log(`   Zaubacorp total: ${results.length} companies`);
  return results;
}

// ─── MERGE & DEDUPLICATE ─────────────────────────────────────────────────────

function mergeResults(lists) {
  const seen = new Set();
  const merged = [];

  for (const list of lists) {
    for (const item of list) {
      // Deduplicate by CIN first, then by normalized name
      const key = item.cin ||
        item.name.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 25);

      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  log(`\n   Merged total: ${merged.length} unique companies`);
  return merged;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log("═══════════════════════════════════════════════");
  log("LOANRADAR — Step 1: Fetch Registrations");
  log(`Cities: ${TARGET_CITIES.join(", ")}`);
  log(`Lookback: ${LOOKBACK_DAYS} days`);
  log("═══════════════════════════════════════════════");

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Try primary source first
  let allResults = [];

  const source1 = await fetchFromCompanyDetails();
  allResults.push(...source1);

  // Add Zaubacorp if we need more results
  if (source1.length < 20) {
    log("\nAdding Zaubacorp as supplementary source...");
    const source2 = await fetchFromZaubacorp();
    allResults.push(...source2);
  }

  const merged = mergeResults([allResults]);

  // Save output
  const output = {
    fetchedAt: new Date().toISOString(),
    totalFound: merged.length,
    lookbackDays: LOOKBACK_DAYS,
    targetCities: TARGET_CITIES,
    registrations: merged,
  };

  const outPath = path.join(DATA_DIR, "raw_registrations.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  log(`\n✓ Saved ${merged.length} registrations → data/raw_registrations.json`);
  log("→ Run Step 2 next: node scripts/2_enrich_contacts.js");
}

main().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
