# LoanRadar — Rajasthan
## Complete Setup Guide (Step by Step)

---

## What This Does

Every morning at **8:00 AM automatically**:
- Scans new business registrations in Rajasthan (MCA data)
- Finds owner phone numbers (Justdial / IndiaMART)
- Scores each lead by loan urgency
- Updates your dashboard with **10 fresh leads + AI call scripts**

**Your agent opens the dashboard → sees 10 ready leads → calls only people who need a loan.**

---

## ONE TIME SETUP (takes 20 minutes)

---

### Part 1 — Create GitHub Account (5 minutes)

1. Go to **github.com**
2. Click **Sign Up**
3. Enter email, password, username
4. Verify your email
5. You now have a free GitHub account

---

### Part 2 — Upload This Code to GitHub (5 minutes)

1. Login to github.com
2. Click the **+** button (top right) → **New repository**
3. Repository name: `loanradar-rajasthan`
4. Make it **Public** (required for free dashboard)
5. Click **Create repository**
6. Click **uploading an existing file** link
7. Drag and drop ALL files from this folder
8. Click **Commit changes**

---

### Part 3 — Add Your API Key (2 minutes) — OPTIONAL

This step gives you AI-written call scripts instead of standard ones.
Both work fine — AI ones are just more personalized.

1. In your repository, click **Settings**
2. Left menu → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `ANTHROPIC_API_KEY`
5. Value: your Claude API key from console.anthropic.com
6. Click **Add secret**

---

### Part 4 — Enable GitHub Pages Dashboard (3 minutes)

1. In your repository, click **Settings**
2. Left menu → **Pages**
3. Under **Source** → select **Deploy from branch**
4. Branch: **main**, Folder: **/docs**
5. Click **Save**
6. Wait 2 minutes, then your dashboard URL will appear:
   `https://YOUR_USERNAME.github.io/loanradar-rajasthan`

**IMPORTANT:** Open `docs/index.html` in GitHub and replace
`YOUR_GITHUB_USERNAME` with your actual GitHub username. This connects
your dashboard to your daily data file.

---

### Part 5 — Set Your Target Cities (2 minutes) — OPTIONAL

Default is all major Rajasthan cities. To change:

1. In your repository, click **Settings**
2. Left menu → **Secrets and variables** → **Actions** → **Variables** tab
3. Click **New repository variable**
4. Name: `TARGET_CITIES`
5. Value: `Jaipur,Jodhpur,Kota` (or whichever cities you want)
6. Click **Add variable**

---

### Part 6 — Run It For The First Time (1 minute)

1. In your repository, click **Actions** tab
2. Click **LoanRadar Daily Pipeline** (left side)
3. Click **Run workflow** button (right side)
4. Click green **Run workflow** button
5. Watch it run — takes 10-15 minutes
6. When it shows ✓ green — open your dashboard URL

**Your first real leads are ready.**

---

## DAILY OPERATION (nothing to do)

After setup, GitHub runs the pipeline **automatically every morning at 8 AM.**

You just:
1. Open your dashboard URL in browser
2. Hand the lead list to your agent
3. Agent calls, marks each lead done

---

## DASHBOARD FEATURES

| Feature | How to use |
|---------|-----------|
| **Filter leads** | Click Hot / Warm / Cold tabs |
| **See full details** | Click any lead row |
| **AI call script** | Shown in the detail panel |
| **Mark as called** | Click the Call button |
| **Add notes** | Type in the notes box in detail panel |
| **Your progress** | Top bar shows calls done today |

---

## TROUBLESHOOTING

**Dashboard shows "Demo mode":**
The pipeline hasn't run yet. Go to Actions tab → Run workflow manually.

**Pipeline failed (red ✗):**
Click the failed run → see which step failed → check logs.
Common reason: websites temporarily blocked. Try running again after 1 hour.

**Phone numbers not found:**
~50-70% enrichment rate is normal. For missing phones, search
the business name on Justdial manually — takes 1 minute per lead.

**Fewer than 10 leads:**
Rajasthan may have fewer new registrations some weeks.
Increase `LOOKBACK_DAYS` variable from 7 to 14 in Settings.

---

## COST

| Item | Cost |
|------|------|
| GitHub | Free |
| GitHub Actions (pipeline runs) | Free (2000 min/month, we use ~300) |
| GitHub Pages (dashboard hosting) | Free |
| Data sources (MCA, Justdial) | Free |
| Claude API (AI call scripts) | Optional — ~₹10-15 per day |
| **Total** | **₹0/month (or ₹300-450/month with AI)** |

---

## FILE STRUCTURE

```
loanradar-rajasthan/
├── .github/
│   └── workflows/
│       └── daily_pipeline.yml    ← Runs automatically at 8am
├── scripts/
│   ├── 1_fetch_registrations.js  ← Gets MCA data
│   ├── 2_enrich_contacts.js      ← Finds phone numbers
│   └── 3_score_and_rank.js       ← Scores + writes call scripts
├── docs/
│   └── index.html                ← Your dashboard (GitHub Pages)
├── data/
│   ├── leads_today.json          ← Today's 10 leads (auto-updated)
│   └── run_log.json              ← History of pipeline runs
├── package.json
└── README.md
```
