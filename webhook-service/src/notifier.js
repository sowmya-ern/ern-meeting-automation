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

// Legacy fallback: used when the summarizer did not run (raw Fireflies output).
// Kept in sync with the new format — no more "Hey guys" opener, clean structure.
function formatSummaryBody(summary) {
    const mentions = (summary.attendees ?? []).map(handleFor).map(escapeHtml).join(' ');
    const mentionsLine = mentions ? `${mentions}\n` : '';
    return `📋 <b>${escapeHtml(summary.title)} Update</b>\n\n${mentionsLine}\n📌 <b>Overview</b>\n${withBoldMarkers(summary.overview)}\n\n✅ <b>Action Items</b>\n${withBoldMarkers(summary.action_items)}`;
}

// Overview block: title header, overview paragraph, then one block per summarizer section.
// `sections` is absent whenever the summarizer didn't run — renders overview-only in that case.
function formatOverviewBlock(summary) {
    const header = `📋 <b>${escapeHtml(summary.title)} Update</b>\n\n📌 <b>Overview</b>\n${withBoldMarkers(summary.overview)}`;
    if (!summary.sections || summary.sections.length === 0) return header;

    const sectionBlocks = summary.sections.map((section) => {
        const bullets = section.bullets.map((bullet) => `• ${withBoldMarkers(bullet)}`).join('\n');
        return `\n\n${escapeHtml(section.emoji)} <b>${escapeHtml(section.header)}</b>\n${bullets}`;
    }).join('');

    return `${header}${sectionBlocks}`;
}

// An assignee heading is a bare "**Name**" (or "**@handle**" post-linkify) alone on its own
// line — distinct from an inline deadline bold like "**July 15**" embedded in a sentence.
const ASSIGNEE_HEADING_LINE = /^\*\*[^*\n]+\*\*$/;

// Splits action_items text by assignee heading. Each returned block starts with the heading
// line followed by the bullet lines for that assignee.
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

// Adds a "• " prefix to every non-heading line within an assignee block so items
// render as proper bullets in Telegram rather than plain unindented text.
function addBulletPrefixes(blockText) {
    return blockText.split('\n').map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        // Leave assignee heading lines (bold-marker or <b> wrapped) untouched
        if (ASSIGNEE_HEADING_LINE.test(trimmed) || trimmed.startsWith('<b>')) return line;
        // Already has a bullet or blocker prefix — don't double-prefix
        if (trimmed.startsWith('•') || trimmed.startsWith('⚠️')) return line;
        return `• ${line.trimStart()}`;
    }).join('\n');
}

// Action items block: assignee sections separated by a blank line, with bullet prefixes,
// followed by recording link and Next Steps when present.
function formatTodosBlock(summary) {
    const rawSections = splitActionItemsByAssignee(linkifyBoldNames(summary.action_items));
    const itemsBlock = rawSections
        .map((block) => addBulletPrefixes(withBoldMarkers(block)))
        .join('\n\n');

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

// Single combined post-meeting message: overview + sections, then action items + next steps.
// Replaces the previous two-message split (notifyAgendaOverviewTo + notifyTodosTo).
function formatPostMeetingBody(summary) {
    const overviewBlock = formatOverviewBlock(summary);
    const todosBlock = formatTodosBlock(summary);
    return `${overviewBlock}\n\n${todosBlock}`;
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

    // Legacy path — kept for notifyUnrouted fallback only.
    async function notifySummaryTo(chatId, summary) {
        await send(chatId, formatSummaryBody(summary));
    }

    // Combined single post-meeting message (overview + todos).
    async function notifyPostMeetingTo(chatId, summary) {
        await send(chatId, formatPostMeetingBody(summary));
    }

    // Kept for backwards compatibility and direct callers in tests — delegates to the combined body.
    async function notifyAgendaOverviewTo(chatId, summary) {
        await send(chatId, formatOverviewBlock(summary));
    }

    async function notifyTodosTo(chatId, summary) {
        await send(chatId, formatTodosBlock(summary));
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

    // Feature 11: send a freeform message to the ops chat (e.g. conflict alerts)
    async function notifyOpsMessage(text) {
        await send(opsChatId, escapeHtml(text));
    }

    return { notifySummaryTo, notifyPostMeetingTo, notifyAgendaOverviewTo, notifyTodosTo, notifyOpsFailure, notifyUnrouted, sendPlainText, notifyOpsMessage };
}

module.exports = { createNotifier };
