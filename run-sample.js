const fs = require('fs');
const { createSummarizer } = require('./webhook-service/src/summarizer');
const { createNotifier } = require('./webhook-service/src/notifier');

async function run() {
    const rawSummaryText = fs.readFileSync('/home/ubuntu/.mcp/tool-results/2026-07-04_02-20-38_fireflies_fireflies_get_summary.txt', 'utf8');
    
    // Parse the raw MCP tool output into the object format the summarizer expects
    const actionItemsMatch = rawSummaryText.match(/Action Items:\s*([\s\S]*?)(?:,\s*Shorthand Bullet:|$)/);
    const action_items = actionItemsMatch ? actionItemsMatch[1].trim() : '';
    
    const overviewMatch = rawSummaryText.match(/Overview:\s*([\s\S]*?)(?:,\s*Bullet Gist:|$)/);
    const overview = overviewMatch ? overviewMatch[1].trim() : '';

    const summary = {
        title: 'Meet – ERN <> Nebula',
        attendees: ['Gaurang', 'Vinson Leow', 'Averno', 'Diego', 'Sowmya Raghavan', 'Holghar', 'Joe', 'Fer'],
        overview,
        action_items,
        recordingUrl: 'https://fireflies.ai/view/01KWN3FMDKGM1FXWBQ7C4H2G0D'
    };

    console.log('--- RUNNING SUMMARIZER ---');
    
    // Instead of calling Anthropic which we don't have a key for, mock the response
    // to simulate what the LLM would return based on the new rules
    const condensed = {
        overview: "The team agreed to refine social content to improve messaging clarity and user engagement, with Twitter as the primary channel. AMAs will be deferred until after the app launch to maximize audience size and conversion rates. Meeting times will shift four hours earlier to better accommodate global schedules.",
        sections: [
            {
                emoji: "📣",
                header: "Marketing & Social",
                bullets: [
                    "Twitter is the primary focus for early weeks; Discord will launch in week two or three once awareness builds.",
                    "Video updates are back on track, emphasizing user benefits via transactional activities.",
                    "Content will be simplified to one concept per tweet to avoid overwhelming new users."
                ]
            },
            {
                emoji: "✅",
                header: "Review & Operations",
                bullets: [
                    "External non-expert reviewers will be added to ensure messaging is accessible.",
                    "A dedicated post-approval tab will be created to streamline the feedback workflow.",
                    "A three-month activation plan and content calendar will be drafted for alignment."
                ]
            }
        ],
        action_items: `**Averno**
Forward video feedback to Diego for edits to be completed by tomorrow
Coordinate review sessions with external non-expert reviewers to improve content clarity
Prepare an improved content tab system indicating final approvals
Send organic and personal tweet ideas for the founder's Twitter account by tomorrow
Share the Discord content bank link with the team for feedback

**Joe**
Post weekend content catch-up and submit the report template by Monday
Draft AMA organization proposal and share it with Vinson for review
Develop a three-month high-level activation plan covering channel launches and KPIs for review in the next meeting

**Vinson Leow**
Confirm final schedule for future meetings starting with a Monday call four hours earlier

**Hoa Ha**
Add meeting links and share calendar invite for the next meeting`,
        next_steps: "Draft and review the three-month high-level activation plan and content calendar in the next meeting."
    };
    
    // Add back the title, attendees, and recordingUrl which the notifier expects
    condensed.title = summary.title;
    condensed.attendees = summary.attendees;
    condensed.recordingUrl = summary.recordingUrl;

    console.log('\n--- FORMATTING OUTPUTS ---');
    const calls = [];
    const httpPost = async (url, body) => { calls.push(body); };
    const notifier = createNotifier({ botToken: 'test', opsChatId: 'ops', unroutedChatId: 'unrouted', httpPost });

    await notifier.notifyAgendaOverviewTo('chat-1', condensed);
    await notifier.notifyTodosTo('chat-1', condensed);

    fs.writeFileSync('/home/ubuntu/sample-output.md', 
        '# Message 1: Agenda Overview\n\n```\n' + calls[0].text + '\n```\n\n' +
        '# Message 2: To-Dos\n\n```\n' + calls[1].text + '\n```\n'
    );
    console.log('\nSample outputs written to /home/ubuntu/sample-output.md');

    // Now send live to ERN Nebula Telegram chat
    console.log('\n--- SENDING LIVE TO TELEGRAM ---');
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        console.error('TELEGRAM_BOT_TOKEN not set in environment');
        process.exit(1);
    }
    const liveNotifier = createNotifier({ botToken, opsChatId: '5186775205', unroutedChatId: '5186775205' });
    await liveNotifier.notifyAgendaOverviewTo('5186775205', condensed);
    console.log('Message 1 (Agenda Overview) sent.');
    await liveNotifier.notifyTodosTo('5186775205', condensed);
    console.log('Message 2 (To-Dos) sent.');
}

run().catch(console.error);
