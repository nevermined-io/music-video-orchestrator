import { logger } from "../logger/logger";
import ffmpeg from "fluent-ffmpeg";
import crypto from 'crypto';
import { AGENT_DID } from "../config/env";

/**
 * Retrieves the duration (in seconds) of a remote or local MP4 video.
 *
 * @param {string} videoUrl - The URL (or local path) of the .mp4 file.
 * @returns {Promise<number>} - Resolves with the video duration in seconds.
 */
export async function getVideoDuration(videoUrl: string): Promise<number> {
  if (videoUrl === "") return 0;
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoUrl, (err, metadata) => {
      if (err) {
        return reject(
          new Error(`FFprobe failed for ${videoUrl}: ${err.message}`)
        );
      }
      // The duration is typically in metadata.format.duration
      const duration = metadata?.format?.duration || 0;
      resolve(duration);
    });
  });
}

/**
 * Checks if the current step already has required metadata (lyrics, title, tags).
 * @param step - The step object from the payments API.
 * @returns True if song metadata is present, false otherwise.
 */
export function hasSongMetadata(step: any): boolean {
  if (!step.input_artifacts) return false;
  try {
    if (Array.isArray(step.input_artifacts) && step.input_artifacts[0]) {
      return !!(
        step.input_artifacts[0].lyrics &&
        step.input_artifacts[0].title &&
        step.input_artifacts[0].tags
      );
    }
  } catch {
    logger.error(
      `Could not parse input_artifacts as JSON: ${step.input_artifacts}`
    );
  }
  return false;
}

/**
 * Generates a deterministic agent ID based on the agent name
 * @param agentName - The name of the agent
 * @returns A deterministic agent ID
 */
export const generateDeterministicAgentId = (className?: string): string => {
  if (!className) return AGENT_DID;
  const hash = crypto.createHash('sha256').update(className).digest('hex').substring(0, 32);
  // Format as UUID: 8-4-4-4-12
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
};

/**
 * Generates a random session ID
 * @returns A random session ID
 */
export function generateSessionId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Logs session information for tracking
 * @param agentId - The agent ID
 * @param sessionId - The session ID
 * @param agentName - The name of the agent
 */
export function logSessionInfo(agentId: string, sessionId: string, agentName: string): void {
  console.log(`[${agentName}] Session started - Agent ID: ${agentId}, Session ID: ${sessionId}`);
}
