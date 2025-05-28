import { logMessage } from "../utils/logMessage";
import { logger } from "../logger/logger";
import { PLAN_DID } from "../config/env";
import { performSwapForPlan, isBalanceSufficient } from "./blockchain";
import { sendFriendlySseEvent } from "../utils/sseFriendly";
import { retryOperation } from "../utils/retryOperation";

/**
 * Extracts the token address from a given plan DDO.
 *
 * @param ddo - The plan DDO object.
 * @returns {string | undefined} - The token address, or undefined if not found.
 */
function extractTokenAddress(ddo: any): string | undefined {
  return ddo?.service?.[2]?.attributes?.additionalInformation
    ?.erc20TokenAddress;
}

/**
 * Extracts the token name from a given plan DDO.
 *
 * @param ddo - The plan DDO object.
 * @returns {string | undefined} - The token name, or undefined if not found.
 */
function extractTokenName(ddo: any): string | undefined {
  return ddo?.service?.[2]?.attributes?.additionalInformation?.symbol;
}

/**
 * Extracts the subscription price from a given plan DDO.
 *
 * @param ddo - The plan DDO object.
 * @returns {string} - The subscription price, or undefined if not found.
 */
function extractPlanPrice(ddo: any): string {
  return (
    ddo?.service?.[2]?.attributes?.additionalInformation?.priceHighestDenomination?.toString() ||
    "0"
  );
}

/**
 * Extracts the agent's wallet address from our own plan DDO.
 *
 * @param ddo - Our plan DDO object.
 * @returns {string} - The agent's wallet address, or undefined if not found.
 */
function extractAgentWallet(ddo: any): string {
  return ddo?.publicKey?.[0]?.owner || "";
}

/**
 * Ensures the payment plan has sufficient balance to execute a new task.
 * If the balance is below the required threshold, it attempts to purchase credits.
 * Additionally, if the external plan's payment token differs from our own token (extracted from our own plan DDO)
 * and our balance is insufficient, it performs a swap using Uniswap V2.
 *
 * The subscription price is determined by the external plan's DDO (in service[0].attributes.main.price).
 * If available, that value is used as the required amount.
 *
 * @async
 * @param planDid - The DID of the payment plan to check.
 * @param step - The current step data (used for logging and updating step status).
 * @param payments - The Nevermined Payments instance.
 * @param requiredBalance - The minimum required credits for this task (default is 1).
 * @returns {Promise<boolean>} - Returns true if sufficient balance is secured, false otherwise.
 */
export async function ensureSufficientBalance(
  planDid: string,
  step: any,
  payments: any,
  requiredBalance: number = 1,
  agentName: string = ""
): Promise<boolean> {
  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Checking balance for plan ${planDid}...`,
  });
  sendFriendlySseEvent(
    step.task_id,
    "reasoning",
    `Checking balance ${agentName ? "for " + agentName + " agent" : ""}`,
    { planDID: planDid }
  );
  let balanceResult;
  try {
    balanceResult = await retryOperation(
      () => payments.getPlanBalance(planDid),
      2,
      async (err, attempt, maxRetries) => {
        sendFriendlySseEvent(
          step.task_id,
          "warning",
          `Failed to get balance for plan ${planDid} (attempt ${attempt + 1}/${
            maxRetries + 1
          }): ${err.message}. Retrying...`,
          { planDID: planDid }
        );
      }
    );
  } catch (error: any) {
    sendFriendlySseEvent(
      step.task_id,
      "error",
      `Failed to get balance for plan ${planDid}: ${error.message}`,
      { planDID: planDid }
    );
    logger.error(`Error getting balance for plan ${planDid}: ${error.message}`);
    await logMessage(payments, {
      task_id: step.task_id,
      level: "error",
      message: `Error getting balance for plan ${planDid}: ${error.message}`,
    });
    return false;
  }

  if (
    parseInt(balanceResult.balance) < requiredBalance &&
    !balanceResult.isOwner
  ) {
    sendFriendlySseEvent(
      step.task_id,
      "reasoning",
      `Balance checked. Insufficient balance (Minimum required: ${requiredBalance}). Attempting to purchase credits...`,
      { planDID: planDid }
    );
    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `Insufficient balance for plan ${planDid}. Attempting to purchase credits...`,
    });

    // Retrieve external plan DDO.
    let externalPlanDDO;
    try {
      externalPlanDDO = await retryOperation(
        () => payments.getAssetDDO(planDid),
        2,
        async (err, attempt, maxRetries) => {
          sendFriendlySseEvent(
            step.task_id,
            "warning",
            `Failed to get external plan DDO for ${planDid} (attempt ${
              attempt + 1
            }/${maxRetries + 1}): ${err.message}. Retrying...`,
            { planDID: planDid }
          );
        }
      );
    } catch (error: any) {
      sendFriendlySseEvent(
        step.task_id,
        "error",
        `Failed to get external plan DDO for ${planDid}: ${error.message}`,
        { planDID: planDid }
      );
      return false;
    }
    const externalTokenAddress = extractTokenAddress(externalPlanDDO);
    const externalTokenName = extractTokenName(externalPlanDDO);

    // Retrieve our own plan DDO.
    let ourPlanDDO;
    try {
      ourPlanDDO = await retryOperation(
        () => payments.getAssetDDO(PLAN_DID),
        2,
        async (err, attempt, maxRetries) => {
          sendFriendlySseEvent(
            step.task_id,
            "warning",
            `Failed to get our plan DDO (attempt ${attempt + 1}/${
              maxRetries + 1
            }): ${err.message}. Retrying...`,
            { planDID: PLAN_DID }
          );
        }
      );
    } catch (error: any) {
      sendFriendlySseEvent(
        step.task_id,
        "error",
        `Failed to get our plan DDO: ${error.message}`,
        { planDID: PLAN_DID }
      );
      return false;
    }
    const ourTokenAddress = extractTokenAddress(ourPlanDDO);
    const ourTokenName = extractTokenName(ourPlanDDO);

    // Determine the required subscription price from the external plan DDO.
    const planPrice = extractPlanPrice(externalPlanDDO);

    // If tokens differ, perform a swap to obtain the external token.
    if (
      externalTokenAddress &&
      ourTokenAddress &&
      externalTokenAddress.toLowerCase() !== ourTokenAddress.toLowerCase()
    ) {
      sendFriendlySseEvent(
        step.task_id,
        "reasoning",
        `Plan ${planDid} requires ${planPrice} ${externalTokenName}.`,
        { planDID: planDid }
      );
      const agentWallet: string | undefined = await extractAgentWallet(
        ourPlanDDO
      );
      if (agentWallet) {
        let sufficient;
        try {
          sufficient = await retryOperation(
            () =>
              isBalanceSufficient(externalTokenAddress, agentWallet, planPrice),
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
          sendFriendlySseEvent(
            step.task_id,
            "error",
            `Failed to check balance for ${externalTokenName}: ${error.message}`,
            { planDID: planDid }
          );
          return false;
        }

        if (!sufficient) {
          sendFriendlySseEvent(
            step.task_id,
            "reasoning",
            `We don't have enough ${externalTokenName} to pay for this plan. Attempting to swap...`
          );
          logMessage(payments, {
            task_id: step.task_id,
            level: "info",
            message: `Agent under plan ${planDid} accepts subscriptions in ${externalTokenName}. Attempting swap. Required amount: ${planPrice} ${externalTokenName}`,
          });
          let swapResult;
          try {
            swapResult = await retryOperation(
              () =>
                performSwapForPlan(
                  planPrice,
                  ourTokenAddress,
                  externalTokenAddress,
                  agentWallet,
                  parseInt(Object.keys(ourPlanDDO._nvm.networks)[0])
                ),
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
            sendFriendlySseEvent(
              step.task_id,
              "error",
              `Failed to swap ${ourTokenName} for ${planPrice} ${externalTokenName}: ${error.message}`
            );
            await logMessage(payments, {
              task_id: step.task_id,
              level: "error",
              message: `Failed to swap tokens for plan ${planDid}.`,
            });
            await payments.query.updateStep(step.did, {
              ...step,
              step_status: "Failed",
              output: "Insufficient balance and failed to swap tokens.",
            });
            return false;
          }
          const {
            success: swapSuccess,
            swapTxHash,
            transferTxHash,
          } = swapResult;
          if (!swapSuccess) {
            sendFriendlySseEvent(
              step.task_id,
              "error",
              `Failed to swap ${ourTokenName} for ${planPrice} ${externalTokenName}.`
            );
            await logMessage(payments, {
              task_id: step.task_id,
              level: "error",
              message: `Failed to swap tokens for plan ${planDid}.`,
            });
            await payments.query.updateStep(step.did, {
              ...step,
              step_status: "Failed",
              output: "Insufficient balance and failed to swap tokens.",
            });
            return false;
          }

          sendFriendlySseEvent(
            step.task_id,
            "transaction",
            `Swap transaction successful.`,
            { txHash: swapTxHash }
          );

          sendFriendlySseEvent(
            step.task_id,
            "transaction",
            `Transfer transaction successful.`,
            { txHash: transferTxHash }
          );

          await logMessage(payments, {
            task_id: step.task_id,
            level: "info",
            message: `Swap successful for plan ${planDid}. Swap tx: ${swapTxHash}`,
          });
          await logMessage(payments, {
            task_id: step.task_id,
            level: "info",
            message: `Transfer successful for plan ${planDid}. Transfer tx: ${transferTxHash}`,
          });
        }
      }
    }

    const message =
      planPrice == "0"
        ? `Ordering free plan ${planDid}.`
        : `Purchasing credits for plan ${planDid} for ${planPrice} ${externalTokenName}.`;

    sendFriendlySseEvent(
      step.task_id,
      "reasoning",
      `Ordering credits for plan ${planDid}...`,
      { planDID: planDid }
    );
    await logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message,
    });
    try {
      const orderResult: any = await retryOperation(
        () => payments.orderPlan(planDid),
        2,
        async (err, attempt, maxRetries) => {
          sendFriendlySseEvent(
            step.task_id,
            "warning",
            `Failed to order credits for plan ${planDid} (attempt ${
              attempt + 1
            }/${maxRetries + 1}): ${err.message}. Retrying...`,
            { planDID: planDid }
          );
        }
      );
      if (!orderResult.success) {
        throw new Error(
          `Failed to order credits for plan ${planDid}: Insufficient balance and failed to purchase credits..`
        );
      }
      sendFriendlySseEvent(
        step.task_id,
        "reasoning",
        `Credits ordered for plan ${planDid}. Tx: ${orderResult.agreementId}`,
        { planDID: planDid }
      );
      await logMessage(payments, {
        task_id: step.task_id,
        level: "info",
        message: `Ordered credits for plan ${planDid}. Tx: ${orderResult.agreementId}`,
      });
    } catch (error) {
      sendFriendlySseEvent(
        step.task_id,
        "error",
        `Failed to order credits for plan ${planDid}. Insufficient balance and failed to purchase credits: ${error.message}`,
        { planDID: planDid }
      );
      logger.error(
        `Error ordering credits for plan ${planDid}: ${error.message}`
      );
      await logMessage(payments, {
        task_id: step.task_id,
        level: "error",
        message: `Error ordering credits for plan ${planDid}: ${error.message}`,
      });
      await payments.query.updateStep(step.did, {
        ...step,
        step_status: "Failed",
        output: `Error ordering credits for plan ${planDid}: ${error.message}`,
      });
      return false;
    }
  }

  // When the balance is sufficient, before returning true:
  sendFriendlySseEvent(
    step.task_id,
    "reasoning",
    `Sufficient balance for plan ${planDid} in task ${step.task_id}`,
    { planDID: planDid }
  );

  return true;
}

/**
 * Gets the parameters needed to search for the burn of an ERC1155 NFT from the plan DID and the step.
 *
 * @param {any} payments - Payments instance.
 * @param {string} planDid - DID of the plan.
 * @param {any} step - Step object (must contain wallet and tokenId).
 * @returns {Promise<{ contractAddress: string, fromWallet: string, operator: string, tokenId: string | number } | undefined>}
 */
export async function getBurnParamsForPlan(
  payments: any,
  planDid: string,
  step: any
) {
  const ddo = await payments.getAssetDDO(planDid);
  const contractAddress = extractTokenAddress(ddo);
  const fromWallet = step.wallet;
  const tokenId = step.tokenId;
  const operator = "0x5838B5512cF9f12FE9f2beccB20eb47211F9B0bc";

  if (contractAddress && fromWallet && tokenId !== undefined) {
    return {
      contractAddress,
      fromWallet,
      operator,
      tokenId,
    };
  }
  return undefined;
}
