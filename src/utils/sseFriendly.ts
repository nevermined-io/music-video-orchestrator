import { sendSseEvent } from "../sseServer";
import OpenAI from "openai";
import {
  addConversationMessage,
  ConversationMessage,
  getConversationData,
  replaceConversationMessage,
  runInQueue,
} from "./conversationStore";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * Calls an LLM to generate a user-friendly explanation for a technical action.
 * @param userRequest - The original user request.
 * @param conversationHistory - The conversation history (array of {role, content}).
 * @param currentStatus - The current status of the process.
 * @returns {Promise<string>} - The user-friendly explanation.
 */
async function getFriendlyExplanation(
  conversationHistory: ConversationMessage[]
): Promise<string> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const systemPrompt = `You are a chatbot that interacts with a user who has requested you to create a music video.
You will be given a system prompt that contains the current status of the process.
Your task is to transfer the current status to the user as briefly, literally, and completely as possible, without omitting or adding any information.

Rules:

Reproduce the information from the current status exactly as it appears, including all details, lists, steps, numbers, etc., except for technical error messages (see below).
Do NOT summarize, rephrase, explain, paraphrase, or infer, except as required by rule for errors below.
Do NOT omit any piece of information, regardless of how minor it looks.
If the current status is formatted (like a list or with line breaks), keep the exact format. Only improve formatting if it's illegible.
If the message contains technical terms, hashes, urls, or lists, include all of them, as shown in the message.
Do NOT change the order or structure.
If the status message is unformatted, nonsense, or not user-friendly, rewrite it just for legibility, keeping all information.
If you do not know how to handle the current status, just reproduce it as it is.
Never make up or infer information. Never explain or contextualize.
Special Rule: TECHNICAL ERRORS

If the status contains a technical error with stack traces, UUIDs, file paths, raw JSON errors, or other unhelpful internal details, extract only the main actions and human-meaningful error reasons (for example: "Failed to order credits for plan. Reason: forbidden." or "Subscription purchase failed: insufficient balance.").
Ignore all stack traces, UUIDs, code fragments, file paths, and detailed object dumps—the user does not need them.

Be as literal and complete as possible, but filter and synthesize only for technical error verbosity.`;

  // Map roles to OpenAI-compatible roles
  const mappedHistory: ChatCompletionMessageParam[] = conversationHistory;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...mappedHistory,
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages,
    max_tokens: 1024,
    temperature: 0.6,
  });

  return response.choices[0].message?.content?.trim() || "";
}

/**
 * Generates a user-friendly SSE event using an LLM and sends it.
 * @param taskId - The task ID.
 * @param type - The event type.
 * @param currentStatus - The current status of the process.
 * @param metadata - Optional metadata to include (planDID, agentDID, txHash, etc).
 */
export async function sendFriendlySseEvent(
  taskId: string,
  type:
    | "reasoning"
    | "answer"
    | "transaction"
    | "error"
    | "warning"
    | "callAgent",
  currentStatus: string,
  metadata?: Record<string, any>,
  artifacts?: { mimeType: string; parts: any[] }
) {
  await runInQueue(taskId, async () => {
    const messageId = addConversationMessage(taskId, currentStatus);
    const conversationData = await getConversationData(taskId);

    const friendly = await getFriendlyExplanation(conversationData);

    replaceConversationMessage(taskId, messageId, friendly);
    sendSseEvent(taskId, {
      content: friendly,
      type,
      artifacts,
      ...(metadata || {}),
    });
  });
}
