import { PlanDDOHelper } from "./PlanDDOHelper";
import {
  performSwapForPlan,
  isBalanceSufficient,
  getBlockNumber,
  findERC1155Mints,
} from "./blockchain";
import { PLAN_DID } from "../config/env";
import { logMessage } from "../utils/logMessage";
import { sendFriendlySseEvent } from "../utils/sseFriendly";
import { retryOperation } from "../utils/retryOperation";
import { logger } from "../logger/logger";

/**
 * Checks the plan balance and returns the result or null if error.
 * @param payments - Payments instance
 * @param planDid - Plan DID
 * @param step - Step data
 * @param agentName - Agent name (optional, for logs)
 * @returns {Promise<any|null>} - Balance result or null if error
 */
async function getAndCheckBalance(
  payments: any,
  planDid: string,
  step: any,
  agentName: string = ""
): Promise<any | null> {
  await sendInfoAndLog(
    payments,
    step,
    `Checking balance ${agentName ? "for " + agentName + " agent" : ""}`,
    "reasoning",
    { planDid }
  );
  let balanceResult;
  try {
    balanceResult = await payments.getPlanBalance(planDid);
  } catch (error: any) {
    await sendStepErrorAndLog(
      payments,
      step,
      planDid,
      `Failed to get balance for plan ${planDid}: ${error.message}`
    );
    return null;
  }
  return balanceResult;
}

/**
 * Handles the flow when balance is insufficient.
 * @param planHelper - External PlanDDOHelper
 * @param ourPlanHelper - Our PlanDDOHelper
 * @param step - Step data
 * @param requiredBalance - Required balance
 * @returns {Promise<boolean>} - True if balance secured, false otherwise
 */
async function handleInsufficientBalance(
  planHelper: PlanDDOHelper,
  ourPlanHelper: PlanDDOHelper,
  step: any,
  requiredBalance: number
): Promise<boolean> {
  const payments = planHelper.payments;
  const planDid = planHelper.planDid;
  await sendInfoAndLog(
    payments,
    step,
    `Balance checked. Insufficient balance (Minimum required: ${requiredBalance}). Attempting to purchase credits...`,
    "reasoning",
    { planDid }
  );
  const externalTokenAddress = await planHelper.getTokenAddress();
  const ourTokenAddress = await ourPlanHelper.getTokenAddress();
  if (
    externalTokenAddress &&
    ourTokenAddress &&
    externalTokenAddress.toLowerCase() !== ourTokenAddress.toLowerCase()
  ) {
    const swapSuccess = await handleTokenSwapIfNeeded(
      planHelper,
      ourPlanHelper,
      step
    );
    if (!swapSuccess) {
      return false;
    }
  }
  return await orderCreditsForPlan(
    payments,
    planDid,
    step,
    planHelper,
    ourPlanHelper
  );
}

/**
 * Handles token swap if needed, extracting all required data from helpers.
 * @param planHelper - External PlanDDOHelper
 * @param ourPlanHelper - Our PlanDDOHelper
 * @param step - Step data
 * @returns {Promise<boolean>} - True if swap successful or not needed, false otherwise
 */
async function handleTokenSwapIfNeeded(
  planHelper: PlanDDOHelper,
  ourPlanHelper: PlanDDOHelper,
  step: any
): Promise<boolean> {
  const payments = planHelper.payments;
  const planDid = planHelper.planDid;

  // Extract all required data here
  const planPrice = await planHelper.getPlanPrice();
  const externalTokenAddress = await planHelper.getTokenAddress();
  const externalTokenName = (await planHelper.getTokenName()) || "";
  const ourTokenAddress = await ourPlanHelper.getTokenAddress();
  const ourTokenName = (await ourPlanHelper.getTokenName()) || "";
  const agentWallet = (await ourPlanHelper.getAgentWallet()) || "";

  // Ensure required addresses are present
  if (!externalTokenAddress || !ourTokenAddress || !agentWallet) {
    await sendStepErrorAndLog(
      payments,
      step,
      planDid,
      `Missing required address for token swap: ${
        !externalTokenAddress ? "externalTokenAddress" : ""
      } ${!ourTokenAddress ? "ourTokenAddress" : ""} ${
        !agentWallet ? "agentWallet" : ""
      }`
    );
    return false;
  }

  await sendInfoAndLog(
    payments,
    step,
    `Plan ${planDid} accepts ${planPrice} ${externalTokenName}. Checking if agent has enough balance...`
  );

  let sufficient;
  try {
    sufficient = await retryOperation(
      () => isBalanceSufficient(externalTokenAddress, agentWallet, planPrice),
      2,
      async (err, attempt, maxRetries) => {
        sendFriendlySseEvent(
          step.task_id,
          "warning",
          `Failed to check balance for ${externalTokenName} (attempt ${
            attempt + 1
          }/${maxRetries + 1}): ${err.message}. Retrying...`,
          { planDID: planDid }
        );
      }
    );
  } catch (error: any) {
    await sendStepErrorAndLog(
      payments,
      step,
      planDid,
      `Failed to check balance for ${externalTokenName}: ${error.message}`
    );
    return false;
  }

  if (!sufficient) {
    await sendInfoAndLog(
      payments,
      step,
      `Agent under plan ${planDid} accepts subscriptions in ${externalTokenName}. Attempting swap. Required amount: ${planPrice} ${externalTokenName}`
    );
    let swapResult;
    try {
      swapResult = await retryOperation(
        async () => {
          const ourPlanDDO = await ourPlanHelper.loadDDO();
          return await performSwapForPlan(
            planPrice,
            ourTokenAddress,
            externalTokenAddress,
            agentWallet,
            parseInt(Object.keys(ourPlanDDO._nvm.networks)[0])
          );
        },
        2,
        async (err, attempt, maxRetries) => {
          sendFriendlySseEvent(
            step.task_id,
            "warning",
            `Failed to swap tokens (attempt ${attempt + 1}/${
              maxRetries + 1
            }): ${err.message}. Retrying...`,
            { planDID: planDid }
          );
        }
      );
    } catch (error: any) {
      await sendStepErrorAndLog(
        payments,
        step,
        planDid,
        `Failed to swap ${ourTokenName} for ${planPrice} ${externalTokenName}: ${error.message}`
      );
      return false;
    }
    const { success: swapSuccess, swapTxHash, transferTxHash } = swapResult;
    if (!swapSuccess) {
      await sendStepErrorAndLog(
        payments,
        step,
        planDid,
        `Failed to swap ${ourTokenName} for ${planPrice} ${externalTokenName}.`
      );
      return false;
    }
    await sendInfoAndLog(payments, step, `Swap successful`, "transaction", {
      txHash: swapTxHash,
    });
    await sendInfoAndLog(payments, step, `Transfer successful`, "transaction", {
      txHash: transferTxHash,
    });
  }
  return true;
}

/**
 * Orders credits for the plan and confirms by searching for the mint event.
 * @param payments - Payments instance
 * @param planDid - Plan DID
 * @param step - Step data
 * @param planHelper - PlanDDOHelper instance (external)
 * @param ourPlanHelper - PlanDDOHelper instance (our own)
 * @returns {Promise<boolean>} - True if credits ordered, false otherwise
 */
async function orderCreditsForPlan(
  payments: any,
  planDid: string,
  step: any,
  planHelper: PlanDDOHelper,
  ourPlanHelper: PlanDDOHelper
): Promise<boolean> {
  const fromBlock = await getBlockNumber();
  try {
    const orderResult: any = await retryOperation(
      () => payments.orderPlan(planDid),
      2,
      async (err, attempt, maxRetries) => {
        sendFriendlySseEvent(
          step.task_id,
          "warning",
          `Failed to purchase credits for plan ${planDid} (attempt ${
            attempt + 1
          }/${maxRetries + 1}): ${err.message}. Retrying...`,
          { planDID: planDid }
        );
      }
    );
    if (!orderResult.success) {
      throw new Error(
        `Failed to purchase credits for plan ${planDid}: Insufficient balance and failed to purchase credits...`
      );
    }
    const mintEvents = await findERC1155Mints(
      planHelper,
      ourPlanHelper,
      fromBlock
    );
    if (mintEvents.length > 0) {
      const mintEvent = mintEvents[mintEvents.length - 1];
      await sendInfoAndLog(
        payments,
        step,
        `Orchestrator agent purchased ${mintEvent.value} credits for plan ${planDid}`,
        "nvm-transaction-agent",
        { txHash: mintEvent.txHash, credits: mintEvent.value, planDid }
      );
    } else {
      await sendInfoAndLog(
        payments,
        step,
        `Orchestrator agent purchased credits for plan ${planDid}`
      );
    }
    return true;
  } catch (error: any) {
    await sendStepErrorAndLog(
      payments,
      step,
      planDid,
      `Failed to order credits for plan ${planDid}. Insufficient balance and failed to purchase credits: ${error.message}`
    );
  }
  return false;
}

/**
 * Utility to send error and log.
 * @param payments - Payments instance
 * @param step - Step data
 * @param planDid - Plan DID
 * @param errorMessage - Error message
 */
async function sendStepErrorAndLog(
  payments: any,
  step: any,
  planDid: string,
  errorMessage: string
): Promise<void> {
  sendFriendlySseEvent(step.task_id, "error", errorMessage, {
    planDID: planDid,
  });
  logger.error(errorMessage);
  await logMessage(payments, {
    task_id: step.task_id,
    level: "error",
    message: errorMessage,
  });
  await payments.query.updateStep(step.did, {
    ...step,
    step_status: "Failed",
    output: errorMessage,
  });
}

/**
 * Utility to send info and log.
 * @param payments - Payments instance
 * @param step - Step data
 * @param message - Message
 * @param level - Log level (default: "reasoning")
 * @param extraData - Extra data for SSE (optional)
 */
async function sendInfoAndLog(
  payments: any,
  step: any,
  message: string,
  level: "reasoning" | "transaction" | "nvm-transaction-agent" = "reasoning",
  extraData?: any
): Promise<void> {
  await sendFriendlySseEvent(step.task_id, level, message, {
    ...extraData,
  });
  logger.info(message);
  await logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message,
  });
}

/**
 * Ensures the payment plan has sufficient balance to execute a new task.
 * @async
 * @param planHelper - Instance of PlanDDOHelper for the external plan.
 * @param step - The current step data (used for logging and updating step status).
 * @param requiredBalance - The minimum required credits for this task (default is 1).
 * @param agentName - Name of the agent (optional, for logs).
 * @returns {Promise<boolean>} - Returns true if sufficient balance is secured, false otherwise.
 */
export async function ensureSufficientBalance(
  planHelper: PlanDDOHelper,
  step: any,
  requiredBalance: number = 1,
  agentName: string = ""
): Promise<boolean> {
  const payments = planHelper.payments;
  const planDid = planHelper.planDid;
  const balanceResult = await getAndCheckBalance(
    payments,
    planDid,
    step,
    agentName
  );
  if (!balanceResult) return false;
  if (
    parseInt(balanceResult.balance) < requiredBalance &&
    !balanceResult.isOwner
  ) {
    const ourPlanHelper = new PlanDDOHelper(payments, PLAN_DID);
    return await handleInsufficientBalance(
      planHelper,
      ourPlanHelper,
      step,
      requiredBalance
    );
  }
  await sendInfoAndLog(
    payments,
    step,
    `Sufficient balance for plan ${planDid}`
  );
  return true;
}
