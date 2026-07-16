import requests

BOT_TOKEN = "8801692679:AAGiCNOlV_APZ7ZCtSbNa0j1B6f9FPyLBBs"
CHAT_ID = "-1003984323489"  # ERN Super Team (supergroup)

def send(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    resp = requests.post(url, json={
        "chat_id": CHAT_ID,
        "text": text,
        "parse_mode": "HTML"
    })
    data = resp.json()
    if data.get("ok"):
        print("✅ Sent successfully")
    else:
        print(f"❌ Error: {data}")

summary = """📅 <b>ERN Meeting Summaries — 13 Jul</b>

<b>1️⃣ ERN Daily Sync</b>

• Fundraising declared the sole company focus for the month — all non-critical tasks deferred until the raise closes
• Vinson attended a high-end private investor conference (~180 attendees, $500K+ entry) — key networking done
• Sowmya met 2–3 VCs and compiled feedback into Excel; VC review call held at 2:30pm GST
• Seed round framing confirmed: sell the idea and team — product is a supporting asset, not the primary pitch
• Closing the raise unlocks hiring of at least 5 new staff and enables Spider collaboration (requires 1M EC users Y1)
• Node specs and NFT technical work postponed — not critical in next 30 days; app UI/UX delegated to Rob and Will
• Marketing results reviewed — only 30 new followers in 2 weeks; content-only strategy declared ineffective
• Content payments paused; urgent pivot discussion with Fer (Nebula) and Bonfire flagged
• AMAs and community activations pushed to month two
• Meeting cadence cut to Tuesdays and Fridays only

<b>2️⃣ VC Feedback Call</b>

• "Live to earn" model seen as outdated and overused — weakening investor interest
• Multi-product approach (Quest app, eSIM, node sale) creates unclear positioning — investors struggle to identify the core market
• Confusion raised over why Earn is raising separately from Cosmic Wire — corporate structure needs clearer explanation
• Positive signal: B2B infrastructure and telecom angle (Assurant, Vodafone) generating real investor interest
• VCs want visible proof points — PRs, pilots, revenue models — before committing
• LP commitments are mostly soft; tracker last updated late June — urgent refresh needed
• Compliance costs around KYC/AML (Scallop) stalling Neobank onboarding — decision pending
• Most operational files scattered across personal drives — full migration to shared drive committed by end of week
• VC feedback to be separated into individual investor documents for cleaner follow-up
• Detailed answers to investor queries to be prepared as a separate reference list

<b>3️⃣ Hoa / Vinson — Investor Outreach Review</b>

• Vinson built a prioritised contact list from the Selenium Summit and Telegram groups — key leads identified and inactive contacts archived
• Top leads: Eunice (Monad co-founder), Jordy and Michael (Synthetix), Variant Fund, ICO Beast (top KOL on Kaito), and a family office co-founder active in 15 token rounds this year
• Arthur Hayes' family office (Bitmex), Coinlist reps, and Further Ventures (Abu Dhabi-backed) also flagged as strong prospects
• Pitching both Cosmic and Earn is causing investor confusion — plan to narrow narrative to Earn only going forward
• Current feedback volume deemed sufficient to begin pitch pivot — Vinson to lead narrative adjustments in next meeting
• Potential partnership with Solana Jupiter (30–40 person team) and Vest Market launchpad explored for Earn's ecosystem growth
• Several investors (Tether, Polymorphic Capital) prefer equity over tokens — outreach approach to be tailored accordingly
• Cosmos Ventures (with "K") largely stopped investing — confirms decision to deprioritise Cosmic in pitch
• All contact notes to be updated and consolidated by Monday; David tasked to send decks to select VCs
• Follow-ups planned for mid-July with interested parties including a contact in Taiwan"""

send(summary)
