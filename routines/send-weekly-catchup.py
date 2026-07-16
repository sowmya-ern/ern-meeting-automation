import requests

BOT_TOKEN = "8801692679:AAGiCNOlV_APZ7ZCtSbNa0j1B6f9FPyLBBs"
CHAT_ID = "-5242393484"  # ERN Super Team

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

# ── Message 1: Weekly Catchup ─────────────────────────────────────────────────
catchup = """<b>📅 ERN Weekly Catchup (7 Jul – 13 Jul)</b>

<b>🚀 Product &amp; App Launch</b>
• App MVP scope simplified: signup, point earning, and referral tracking only for Phase 1
• Unified sign-on (email, social, phone) approved across web and app to consolidate user data
• Development phases split from fundraising: Phase 1 (app launch) → Phase 2 (node sale) → Phase 3 (eSIM)
• UI/UX refresh underway — white mode for web, optional dark mode for app; Apple approval may affect timing
• ⚠️ Jonathan's overdue tasks (node specs, ERD, roadmap) causing delays — clear prioritisation and self-contained Monday.com task tracking now mandated

<b>💰 Fundraising &amp; Partnerships</b>
• Crypto VC market down ~95% — strategy pivoted to target AI and Web2.5 VCs
• Pitch reframed: positioning ERN as enterprise data infrastructure for AI training (Palantir comparison)
• Core tagline finalised: <i>"Behavior earns, identity stays private"</i>
• Partnership blurbs simplified — one-liner per partner, jargon removed, linked to token holder value
• Zambia press release (month-end) and Assurance partnership confirmation (next month) are key upcoming milestones
• Outreach expanding beyond VCs to industry contacts; daily progress updates now tracked

<b>👥 Team &amp; Operations</b>
• Role clarity enforced: Sowmya shifting from daily ops to strategic outreach and product; Hoa supporting marketing and BD
• Brand Guide v2.2 and updated investor deck distributed across all groups
• Junior design quality issues escalated — Earn design team to mentor Bond designers to reduce review cycles
• Weekly product syncs established to improve communication and task handoffs"""

# ── Message 2: Today's Agenda ─────────────────────────────────────────────────
agenda = """Hey guys, please find the meeting agenda for today. Lmk if I missed any items 👇

<b>@vinsonleow</b>
• Review and approve the final MVP app scope and features
• Align on KPIs and growth targets post-product clarity
• Discuss role and title adjustments for Sowmya
• Review updated partnership blurbs from Hoa before Friday deadline
• Confirm Zambia press release timeline and Assurance partnership next steps
• Provide updated fundraising details and pitch deck to Sowmya for outreach

<b>@hoaha47</b>
• Present updated website sign-up flow text and branding changes
• Review condensed one-line descriptions for all partnerships
• Confirm distribution of Brand Guide v2.2 to all relevant groups
• Update task comments in Monday.com — add document links and clarify Jonathan's responsibilities on node specs, ERD, and roadmap
• Follow up with Kelly on investor update approvals and peptide distribution details
• Confirm Vodafone partnership and Klaviyo account consolidation status
• Compile outreach contact list and begin investor/partner conversations

<b>@sraghavan</b>
• Provide update on AI/Web2.5 VC outreach progress and early feedback
• Present simplified UI/UX specs and master Excel sheet
• Confirm setup of weekly product syncs and GitHub branch for UI changes
• Share daily outreach progress update in group chat
• Prepare prioritised task list for Jonathan's overdue items
• Draft lending and borrowing sections for the white paper"""

send(catchup)
send(agenda)
