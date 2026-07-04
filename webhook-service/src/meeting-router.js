// rules is an ORDERED array of { match, chatId, seriesKey }, checked most-specific-first.
// e.g. 'Bond <> Nebula' must precede 'Bond' so a Bond<>Nebula meeting doesn't
// fall into the looser Bond Team rule.
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

    return { resolveChatId, resolveSeriesKey };
}

module.exports = { createMeetingRouter };
