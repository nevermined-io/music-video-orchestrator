import { initializePayments } from "./payments/paymentsInstance";
import { processSteps } from "./steps/stepHandlers";
import { NVM_API_KEY, NVM_ENVIRONMENT, AGENT_DID } from "./config/env";
import { logger } from "./logger/logger";
import { startSseServer } from "./sseServer";

/**
 * Main entry point for the Music Video Orchestrator.
 * It initializes the Nevermined Payments instance, subscribes to step-updated events,
 * and starts listening for workflow steps relevant to this orchestrator's AGENT_DID.
 *
 * @async
 * @function main
 * @returns {Promise<void>}
 */
async function main() {
  try {
    // Start SSE server for task events
    startSseServer(3001);
    const payments = initializePayments(NVM_API_KEY, NVM_ENVIRONMENT);
    logger.info(`Connected to Nevermined Network: ${NVM_ENVIRONMENT}`);

    await payments.query.subscribe(processSteps(payments), {
      joinAccountRoom: false,
      joinAgentRooms: [AGENT_DID],
      subscribeEventTypes: ["step-updated"],
      getPendingEventsOnSubscribe: false,
    });

    logger.info(
      "Music Video Orchestrator is running and listening for events..."
    );
  } catch (error) {
    logger.error(`Error in main function: ${error.message}`);
  }
}

main();
