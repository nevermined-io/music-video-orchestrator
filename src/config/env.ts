import dotenv from "dotenv";

dotenv.config();

/**
 * Nevermined API key to authenticate against the Payments API.
 */
export const NVM_API_KEY = process.env.NVM_API_KEY!;

/**
 * Nevermined environment: 'testing', 'staging', or 'production'.
 */
export const NVM_ENVIRONMENT = process.env.NVM_ENVIRONMENT || "testing";

/********************/
/*   AGENT DIDs     */
/********************/

/**
 * DID of this Orchestrator Agent.
 */
export const AGENT_DID = process.env.AGENT_DID!;

/**
 * DID of the sub-agent that generates music video scripts.
 */
export const MUSIC_SCRIPT_GENERATOR_DID =
  process.env.MUSIC_SCRIPT_GENERATOR_DID!;

/**
 * DID of the sub-agent that generates songs.
 */
export const SONG_GENERATOR_DID = process.env.SONG_GENERATOR_DID!;

/**
 * DID of the sub-agent that generates video clips.
 */
export const VIDEO_GENERATOR_DID = process.env.VIDEO_GENERATOR_DID!;

/********************/
/*   PLAN DIDs      */
/********************/

/**
 * DID of the song generator payment plan.
 */
export const SONG_GENERATOR_PLAN_DID = process.env.SONG_GENERATOR_PLAN_DID!;

/**
 * DID of the music video script payment plan.
 */
export const MUSIC_SCRIPT_GENERATOR_PLAN_DID =
  process.env.MUSIC_SCRIPT_GENERATOR_PLAN_DID!;

/**
 * DID of the payment plan used by the video generator (if separate).
 */
export const VIDEO_GENERATOR_PLAN_DID = process.env.VIDEO_GENERATOR_PLAN_DID!;

/********************/
/*        AWS       */
/********************/
export const AWS_REGION = process.env.AWS_REGION!;
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID!;
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY!;
