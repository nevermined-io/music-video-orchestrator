import { logger } from "../logger/logger";
import { TaskLogMessage } from "@nevermined-io/payments";

/**
 * Logs a message both locally (using pino) and remotely via the Nevermined Payments API.
 *
 * @async
 * @function logMessage
 * @param {any} payments - The Nevermined Payments instance used for remote logging.
 * @param {TaskLogMessage} logMessage - The log data, including task_id, log level, and message.
 * @returns {Promise<void>}
 */
export async function logMessage(payments, logMessage: TaskLogMessage) {
  const message = `${logMessage.task_id} :: ${logMessage.message}`;

  switch (logMessage.level) {
    case "error":
      logger.error(message);
      break;
    case "warning":
      logger.warn(message);
      break;
    case "debug":
      logger.debug(message);
      break;
    default:
      logger.info(message);
  }

  await payments.query.logTask(logMessage);
}
