import requests

TOKEN = "8801692679:AAGiCNOlV_APZ7ZCtSbNa0j1B6f9FPyLBBs"
CHAT_ID = "-1003984323489"  # ERN Super Team (supergroup)

agenda = """📋 <b>ERN Agenda — 16 Jul</b>

Hey guys, please find the meeting agenda for today. Lmk if I missed any items 👇

<b>@vinsonleow</b>
🔴 Lead VC feedback review — extract prioritised action points for marketing, product, and investor queries
🔴 Contact Jonathan to finalise list of Layer 1 blockchain suitability and transactional cost requirements
🔴 Clarify with Jared and Kelly the token utility narrative and rationale for project setup distinct from Cosmic Wire
🟡 Coordinate with Jared on advisory appointments (Mike Pompeo and others) and push for Sowmya full-time post-studies
🟡 Collect and oversee Bond handover plans — leadership, marketing, and growth split
🟢 Inform Zero G team of critical unresolved bugs and issue product feedback follow-ups with screenshots

<b>@hoaha47</b>
🔴 Prepare detailed Google Sheet breakup of Bond tasks by marketing, growth, and leadership for handover
🔴 Forward unresolved bug reports (borrowing, deposit failures, wallet balance issues) to Bond product feedback channel
🟡 Coordinate with Sowmya and Vinson on consolidated VC feedback document — prioritised with action outlines
🟡 Continue scheduling Bond marketing candidate interviews — hold second rounds pending handover clarity
🟢 Ping Kelly for latest org chart reflecting recent Cosmic Wire downsizing

<b>@sraghavan</b>
🔴 Combine and clean all VC feedback into a single structured document with priority levels (high/medium/low)
🔴 Retest all borrow and lending functions in Beta — document critical bugs for escalation
🟡 Help prepare strategic overview of eSIM business model — unit economics, sales targets, token utility for VCs
🟡 Support rework of narrative away from "Live to Earn" branding — replace with data infrastructure messaging
🟢 Assist Jonathan in clarifying technical requirements and token usage for Layer 1 blockchain alternatives"""

resp = requests.post(
    f"https://api.telegram.org/bot{TOKEN}/sendMessage",
    json={"chat_id": CHAT_ID, "text": agenda, "parse_mode": "HTML"}
)
print("Status:", resp.status_code, resp.json().get("ok"))
