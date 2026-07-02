// rules is an ORDERED array of { match, chatId }, checked most-specific-first.
// e.g. 'Bond <> Nebula' must precede 'Bond' so a Bond<>Nebula meeting doesn't
// fall into the looser Bond Team rule.
function createMeetingRouter(rules) {
    function resolveChatId(meetingTitle) {
        const title = meetingTitle || '';
        for (const rule of rules) {
            if (title.includes(rule.match)) return rule.chatId;
        }
        return null;
    }

    return { resolveChatId };
}

module.exports = { createMeetingRouter };
