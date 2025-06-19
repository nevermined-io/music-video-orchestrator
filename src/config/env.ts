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
 * DID of our own payment plan.
 */
export const PLAN_DID = process.env.PLAN_DID!;

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
/*   PINATA       */
/********************/
export const PINATA_API_KEY = process.env.PINATA_API_KEY!;
export const PINATA_API_SECRET = process.env.PINATA_API_SECRET!;

/*******************/
/*   BLOCKCHAIN    */
/*******************/
export const RPC_URL = process.env.RPC_URL!;
export const PRIVATE_KEY = process.env.PRIVATE_KEY!;
export const NETWORK_ID = parseInt(process.env.NETWORK_ID!);
export const UNISWAP_V2_ROUTER_ADDRESS = process.env.UNISWAP_V2_ROUTER_ADDRESS!;
export const UNISWAP_V2_FACTORY_ADDRESS =
  process.env.UNISWAP_V2_FACTORY_ADDRESS!;

/**
 * Environment configuration for the music video orchestrator
 */

export const HELICONE_API_KEY = process.env.HELICONE_API_KEY!;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
