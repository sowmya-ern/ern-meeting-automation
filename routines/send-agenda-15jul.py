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

agenda = """📋 <b>ERN Agenda — 15 Jul</b>

Hey guys, please find the meeting agenda for today. Lmk if I missed any items 👇

<b>@vinsonleow</b>
🔴 Confirm availability and attendance for GSR advisory calls — 2x per week initially, 12pm–6pm PST window; communicate readiness to start next week pending contract review
🔴 Finalise investor outreach messaging for top Cellini Summit contacts — tailored messages per lead
🔴 Confirm Assurance MOU timeline — due Wednesday
🟡 Review and sign off on one-page VC feedback consolidation doc (Sowmya to present)
🟡 Coordinate scheduling preferences for GSR calls with Jared and Kelly
🟢 Confirm receipt of Bon's on-chain payment and communicate update to team

<b>@hoaha47</b>
🔴 Confirm Solentra project and videos fully removed from Linktree — report status today
🟡 Continue refining and prioritising VC feedback with Sowmya — focus on final actionable items for Cosmic team discussion
🟢 Confirm updated email signatures sent to team

<b>@sraghavan</b>
🔴 Present one-page VC feedback consolidation doc to Vinson — remove "Live to Earn" framing and clarify Cosmic's relationship
🟡 Continue refining VC feedback with Hoa — prioritise actionable items only

<b>Jonathan</b>
🔴 Deliver list of diagnostic data points targeted for app data collection — due today (Friday)
🔴 Provide screenshots or short video demonstrating diagnostics in T-Mobile and other partner apps — due today (Friday)
🔴 Confirm internal alpha app (iPhone + Android) ready for testing — battery and network diagnostics enabled
🟡 Confirm Linktree video asset updates — what has been uploaded and removed
🟡 Follow up internally on payment processing with Ivanka's team
🟢 Coordinate with team on who handles payments going forward"""

send(agenda)
