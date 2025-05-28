/**
 * In-memory store for user requests and conversation history by taskId.
 * @module conversationStore
 */

import { v4 as uuidv4 } from "uuid";

export interface ConversationMessage {
  id: string; // Unique identifier for each message
  role: "user" | "assistant" | "system";
  content: string;
}

const conversationStore: Record<string, ConversationMessage[]> = {};

/**
 * Cola de promesas por taskId para serializar el acceso al histórico de mensajes.
 */
const taskQueues: Record<string, Promise<void>> = {};

/**
 * Executes a function in the queue for the given taskId, ensuring sequential access.
 * @param {string} taskId - The task identifier.
 * @param {() => Promise<any>} fn - The function to execute.
 * @returns {Promise<any>} - The result of the function.
 */
async function runInQueue<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  if (!taskQueues[taskId]) {
    taskQueues[taskId] = Promise.resolve();
  }
  let result: T;
  // Chain the function to the queue
  taskQueues[taskId] = taskQueues[taskId].then(() =>
    fn().then((r) => {
      result = r;
    })
  );
  await taskQueues[taskId];
  return result!;
}

/**
 * Sets the user request for a given taskId.
 * @param {string} taskId - The task identifier.
 * @param {string} userRequest - The original user request.
 */
export function setUserRequest(taskId: string, userRequest: string) {
  const newMessage: ConversationMessage = {
    id: uuidv4(),
    role: "user",
    content: userRequest,
  };
  if (!conversationStore[taskId]) {
    conversationStore[taskId] = [newMessage];
  } else {
    conversationStore[taskId].push(newMessage);
  }
}

/**
 * Adds a message to the conversation history for a given taskId.
 * @param {string} taskId - The task identifier.
 * @param {string} message - The message to add.
 */
export function addConversationMessage(taskId: string, message: string) {
  const newMessage: ConversationMessage = {
    id: uuidv4(),
    role: "system",
    content: "Message to process: " + message,
  };
  if (!conversationStore[taskId]) {
    conversationStore[taskId] = [newMessage];
  } else {
    conversationStore[taskId].push(newMessage);
  }
  return newMessage.id;
}

/**
 * Gets the conversation data for a given taskId.
 * @param {string} taskId - The task identifier.
 * @returns {ConversationMessage[] | []} - The conversation data or empty array if not found.
 */
export function getConversationData(
  taskId: string
): ConversationMessage[] | [] {
  const data = conversationStore[taskId];
  if (!data) return [];
  return data;
}

/**
 * Replaces an existing message in the conversation history for a given taskId by id.
 * @param {string} taskId - The task identifier.
 * @param {string} messageId - The id of the message to replace.
 * @param {string} message - The message to add.
 */
export function replaceConversationMessage(
  taskId: string,
  messageId: string,
  message: string
) {
  if (!message) return;
  const index = conversationStore[taskId].findIndex(
    (msg) => msg.id === messageId
  );
  if (index !== -1) {
    conversationStore[taskId][index].content = message;
    conversationStore[taskId][index].role = "assistant";
  } else {
    console.log(`Message not found in conversation store: ${messageId}`);
  }
}

export { runInQueue };
