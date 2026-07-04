const axios = require('axios');
const { handleFor, linkifyBoldNames } = require('./attendee-handles');
const { toHtmlBold } = require('./bold-marker');
const { getProfile } = require('./company-profiles');

function defaultHttpPost(url, body, config) {
    return axios.post(url, body, config);
}

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Escapes third-party text first, then converts **bold** markers into <b> tags via the shared
// bold-marker.js contract — the only way bold reaches Telegram, since we never trust raw HTML
// from Fireflies or the summarizer.
function withBoldMarkers(text) {
    return toHtmlBold(escapeHtml(text));
}

function formatSummaryBody(summary) {
    const mentions = (summary.attendees ?? []).map(handleFor).map(escapeHtml).join(' ');
    const mentionsLine = mentions ? `${mentions}\n` : '';
    return `Hey guys please find here the meeting summary for today. Please lmk if anything's missing.\n${mentionsLine}${escapeHtml(summary.title)} Summary\n\nOverview:\n${withBoldMarkers(summary.overview)}\n\nAction Items:\n${withBoldMarkers(summary.action_items)}`;
}

// Message 2 of the post-meeting pair: title, overview, then one block per summarizer section
// (department/topic, emoji + bold header, bulleted lines). `sections` is absent whenever the
// summarizer didn't run (raw Fireflies fallback) — in that case this renders overview-only,
// matching today's simpler behavior rather than forcing an empty Sections block.
function formatAgendaOverviewBody(summary) {
    const header = `📋 <b>${escapeHtml(summary.title)} Update</b>\n\n📌 <b>Overview</b>\n${withBoldMarkers(summary.overview)}`;
    if (!summary.sections || summary.sections.length === 0) return header;

    const sectionBlocks = summary.sections.map((section) => {
        const bullets = section.bullets.map((bullet) => `• ${withBoldMarkers(bullet)}`).join('\n');
        return `\n\n${escapeHtml(section.emoji)} <b>${escapeHtml(section.header)}</b>\n${bullets}`;
    }).join('');

    return `${header}${sectionBlocks}`;
}

// An assignee heading is a bare "**Name**" (or "**@handle**" post-linkify) alone on its own
// line -- distinct from an inline deadline bold like "**July 15**" embedded in a sentence.
const ASSIGNEE_HEADING_LINE = /^\*\*[^*\n]+\*\*$/;

// Nothing guarantees the summarizer's action_items string puts a blank line between one
// assignee's block and the next, so this deterministically splits on each heading and lets
// the caller insert a divider -- Telegram formatting shouldn't depend on the model's whitespace.
function splitActionItemsByAssignee(rawText) {
    const lines = rawText.split('\n');
    const sections = [];
    let current = [];
    for (const line of lines) {
        if (ASSIGNEE_HEADING_LINE.test(line.trim()) && current.length > 0) {
            sections.push(current.join('\n').trim());
            current = [];
        }
        current.push(line);
    }
    if (current.length > 0) sections.push(current.join('\n').trim());
    return sections;
}

// Message 3 of the post-meeting pair: action items (assignee names converted to @handles),
// recording link (when Fireflies gave us one), Next Steps (when the summarizer produced one).
function formatTodosBody(summary) {
    const sections = splitActionItemsByAssignee(linkifyBoldNames(summary.action_items));
    const itemsBlock = sections.map(withBoldMarkers).join('\n\n---\n\n');
    const recordingLine = summary.recordingUrl
        ? `\n\n🎥 <b>Recording</b>\n${escapeHtml(summary.recordingUrl)}`
        : '';
    const nextStepsLines = (summary.next_steps ?? '')
        .split('\n')
        .map((line) => line.trim().replace(/^-\s*/, ''))
        .filter(Boolean)
        .map((line) => `• ${withBoldMarkers(line)}`)
        .join('\n');
    const nextStepsBlock = nextStepsLines ? `\n\n🔜 <b>Next Steps</b>\n${nextStepsLines}` : '';

    return `✅ <b>Action Items</b>\n\n${itemsBlock}${recordingLine}${nextStepsBlock}`;
}

function createNotifier({ botToken, opsChatId, unroutedChatId, httpPost = defaultHttpPost }) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    async function send(chatId, text, parseMode = 'HTML') {
        const body = { chat_id: chatId, text };
        if (parseMode) body.parse_mode = parseMode;
        try {
            return await httpPost(url, body);
        } catch (err) {
            // Surface Telegram's own error description (e.g. "can't parse entities: Unsupported
            // start tag '<>' at byte offset 42") instead of the generic axios status message,
            // so ops failures are immediately diagnosable without reading raw logs.
            const detail = err?.response?.data?.description ?? err.message;
            throw new Error(`Telegram send failed (${err?.response?.status ?? 'unknown'}): ${detail}`);
        }
    }

    async function notifySummaryTo(chatId, summary) {
        await send(chatId, formatSummaryBody(summary));
    }

    async function notifyAgendaOverviewTo(chatId, summary) {
        await send(chatId, formatAgendaOverviewBody(summary));
    }

    async function notifyTodosTo(chatId, summary) {
        await send(chatId, formatTodosBody(summary));
    }

    // Relay path for the pre-meeting Cloud Routine (see ADR-0004): the routine composes plain
    // text itself and never gets the bot token, so this sends it verbatim with no parse_mode.
    async function sendPlainText(chatId, text) {
        await send(chatId, text, null);
    }

    async function notifyOpsFailure(meetingId, reason) {
        await send(opsChatId, `Error processing meeting ${escapeHtml(meetingId)}: ${escapeHtml(reason)}`);
    }

    async function notifyUnrouted(meetingId, meetingTitle, summary, company) {
        const profile = company ? getProfile(company) : null;
        const classificationNote = profile
            ? ` (title didn't match a known series, classified as ${profile.label} by content)`
            : '';
        const text = `No routing match for meeting "${escapeHtml(meetingTitle)}" (${escapeHtml(meetingId)})${escapeHtml(classificationNote)} — sending summary here instead.\n\n${formatSummaryBody(summary)}`;
        await send(unroutedChatId, text);
    }

    return { notifySummaryTo, notifyAgendaOverviewTo, notifyTodosTo, notifyOpsFailure, notifyUnrouted, sendPlainText };
}

module.exports = { createNotifier };
