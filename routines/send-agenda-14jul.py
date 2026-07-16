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

agenda = """📋 <b>ERN Agenda — 14 Jul</b>

Hey guys, please find the meeting agenda for today. Lmk if I missed any items 👇

<b>@vinsonleow</b>
🔴 Share approved investor blurb and clarify investor update process
🔴 Lead pivot discussion with Fer (Nebula) and Bonfire on new marketing strategy — current content getting only 30 followers/2 weeks
🔴 Confirm Zambia press release timeline and Assurance MOU — due Wednesday
🟡 Answer Sowmya's FAQ questions for outreach
🟡 Prepare Cosmic marketing repositioning and stealth plan presentation
🟢 Share availability calendar with Rob for coordinating Jared meetings

<b>@hoaha47</b>
🔴 Compile outreach contact list and begin investor/partner conversations
🔴 Confirm distribution of Brand Guide v2.2 to all relevant groups
🔴 Remove Solentra project and videos from Linktree
🟡 Present updated website sign-up flow text and branding changes — confirm with Rob by tonight
🟡 Review condensed one-line descriptions for all partnerships
🟡 Confirm Vodafone partnership and Klaviyo account consolidation status
🟡 Update task comments in Monday.com — add document links and clarify Jonathan's responsibilities on node specs, ERD, and roadmap
🟢 Prepare strategic overview and LinkTree updates focused on fundraising
🟢 Send updated email signatures to team after Sowmya finalises simplified version
🟢 Move all operational files from personal drive to shared folder — by end of week

<b>@sraghavan</b>
🔴 Share VC feedback Excel and action items from yesterday's review call
🔴 Provide detailed answers to VC queries in a separate list for investor communications
🔴 Finalise and send simplified email signature
🟡 Prepare prioritised task list for Jonathan's overdue items
🟡 Schedule automation review session with Vinson to unblock delays
🟡 Confirm setup of weekly product syncs and GitHub branch for UI changes
🟢 Move all operational files to shared drive by end of week

<b>Jonathan</b>
🔴 Prioritise and complete overdue promotional videos for Zambia Trade and Mobile Forensics — provide delivery timeline today
🔴 Finalise Assurance MOU draft — due Wednesday
🟡 Lead Cosmic stealth rebranding and social media cleanup
🟡 Secure Assurance's inclusion in press release announcements
🟡 Provide updates on Earn and Spider project dependency and progress
🟢 Handle disposal or assessment of Jared's X2 project

<b>Rob</b>
🟡 Liaise with Chris on enabling eSIM in beta accounts for testing
🟢 Search for Eclipse 11 video file — coordinate with Nick or Will"""

send(agenda)
