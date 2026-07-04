// rules is an ORDERED array of { match, chatId, seriesKey, company }, checked
// most-specific-first. e.g. 'Bond <> Nebula' must precede 'Bond' so a Bond<>Nebula meeting
// doesn't fall into the looser Bond Team rule.
function createMeetingRouter(rules) {
    function findRule(meetingTitle) {
        const title = meetingTitle || '';
        return rules.find((rule) => title.includes(rule.match)) || null;
    }

    function resolveChatId(meetingTitle) {
        const rule = findRule(meetingTitle);
        return rule ? rule.chatId : null;
    }

    // Returns null both when no rule matches and when the matched rule has no seriesKey
    // (e.g. tests constructing rules without one) -- callers already treat "no series" as
    // "skip history tracking for this meeting", so both cases collapse to the same null.
    function resolveSeriesKey(meetingTitle) {
        const rule = findRule(meetingTitle);
        return (rule && rule.seriesKey) || null;
    }

    // Same null-collapsing convention as resolveSeriesKey, but for company classification --
    // callers treat "no company from title" as "fall back to the content classifier."
    function resolveCompany(meetingTitle) {
        const rule = findRule(meetingTitle);
        return (rule && rule.company) || null;
    }

    return { resolveChatId, resolveSeriesKey, resolveCompany };
}

module.exports = { createMeetingRouter };
