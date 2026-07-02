function createSeenMeetings() {
  const seen = new Set();

  return {
    has(meetingId) {
      return seen.has(meetingId);
    },
    markSeen(meetingId) {
      seen.add(meetingId);
    },
  };
}

module.exports = { createSeenMeetings };
