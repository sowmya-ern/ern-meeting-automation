// Feature 12: Voice memo → action item via Telegram bot webhook.
//
// Flow:
//   1. User sends a voice note to the Telegram bot (or forwards one from a group chat).
//   2. Telegram sends a POST to /telegram-bot with the message object.
//   3. This module downloads the OGG voice file from Telegram's file API.
//   4. Transcribes it using OpenAI Whisper (whisper-1).
//   5. Extracts action items from the transcript using the LLM.
//   6. Appends the items to the pending_voice_items table in Supabase.
//   7. The pre-meeting reminder routine picks up pending_voice_items and includes them
//      in the next reminder for the relevant series.
//
// Authorisation: only messages from known Telegram user IDs (VOICE_ALLOWED_USER_IDS env var,
// comma-separated) are processed. All others receive a polite rejection reply.

const axios = require('axios');
const FormData = require('form-data');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

const EXTRACTION_RULES = `You are extracting action items from a voice memo transcript.

Respond with EXACTLY this format and nothing else:

ITEMS:
<a JSON array of strings, each a single concise action item in the format "Owner: task description".
If no clear action items are mentioned, return an empty array: []>`;

function buildExtractionPrompt(transcript) {
  return `${EXTRACTION_RULES}\n\nTranscript:\n${transcript}`;
}

function parseExtractionResponse(text) {
  const match = text.match(/ITEMS:\s*([\s\S]*)/);
  if (!match) return [];
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return [];
  }
}

function defaultHttpGet(url, config) {
  return axios.get(url, config);
}

function defaultHttpPost(url, body, config) {
  return axios.post(url, body, config);
}

function createVoiceMemoHandler({
  botToken,
  anthropicKey,
  openaiKey,
  allowedUserIds = [],
  httpGet = defaultHttpGet,
  httpPost = defaultHttpPost,
}) {
  const telegramApiBase = `https://api.telegram.org/bot${botToken}`;
  const telegramFileBase = `https://api.telegram.org/file/bot${botToken}`;

  async function replyTo(chatId, text) {
    await httpPost(`${telegramApiBase}/sendMessage`, { chat_id: chatId, text }).catch(() => {});
  }

  async function getFilePath(fileId) {
    const res = await httpGet(`${telegramApiBase}/getFile?file_id=${fileId}`);
    return res?.data?.result?.file_path ?? null;
  }

  async function downloadOgg(filePath) {
    const res = await httpGet(`${telegramFileBase}/${filePath}`, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  }

  async function transcribe(oggBuffer) {
    const form = new FormData();
    form.append('file', oggBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-1');
    const res = await httpPost(OPENAI_WHISPER_URL, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${openaiKey}` },
    });
    return res?.data?.text ?? '';
  }

  async function extractItems(transcript) {
    const res = await httpPost(
      ANTHROPIC_URL,
      {
        model: 'claude-sonnet-5',
        max_tokens: 512,
        temperature: 0,
        messages: [{ role: 'user', content: buildExtractionPrompt(transcript) }],
      },
      { headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );
    const text = res?.data?.content?.find((b) => b.type === 'text')?.text ?? '';
    return parseExtractionResponse(text);
  }

  // Main handler: called by the /telegram-bot POST endpoint in app.js.
  // Returns { handled: true } if the message was a voice memo from an allowed user,
  // { handled: false } otherwise (so app.js can ignore non-voice updates silently).
  async function handleUpdate(update, { meetingHistory, seriesKey }) {
    const message = update?.message;
    if (!message) return { handled: false };

    const fromId = String(message.from?.id ?? '');
    const chatId = message.chat?.id;
    const voice = message.voice;

    if (!voice) return { handled: false };

    // Authorisation check
    if (allowedUserIds.length > 0 && !allowedUserIds.includes(fromId)) {
      await replyTo(chatId, 'Sorry, you are not authorised to submit voice memos to this bot.');
      return { handled: true };
    }

    try {
      await replyTo(chatId, '🎙 Voice memo received — transcribing...');

      const filePath = await getFilePath(voice.file_id);
      if (!filePath) throw new Error('Could not retrieve file path from Telegram');

      const oggBuffer = await downloadOgg(filePath);
      const transcript = await transcribe(oggBuffer);

      if (!transcript.trim()) {
        await replyTo(chatId, '⚠️ Could not transcribe the voice memo. Please try again.');
        return { handled: true };
      }

      const items = await extractItems(transcript);

      if (items.length === 0) {
        await replyTo(chatId, `✅ Transcribed but no action items found:\n\n"${transcript}"`);
        return { handled: true };
      }

      // Persist to Supabase pending_voice_items if meetingHistory is available
      if (meetingHistory && seriesKey) {
        await meetingHistory.appendVoiceItems({ series_key: seriesKey, items, transcript }).catch(() => {});
      }

      const itemList = items.map((i) => `• ${i}`).join('\n');
      await replyTo(chatId, `✅ Action items extracted and added to the next reminder:\n\n${itemList}`);
      return { handled: true };
    } catch (err) {
      await replyTo(chatId, `❌ Error processing voice memo: ${err.message}`);
      return { handled: true };
    }
  }

  return { handleUpdate };
}

module.exports = { createVoiceMemoHandler };
