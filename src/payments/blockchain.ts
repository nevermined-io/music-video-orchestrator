import { ethers, Contract, Signer, BigNumber } from "ethers";
import { Token, CurrencyAmount, Percent, TradeType } from "@uniswap/sdk-core";
import { Pair, Route, Trade } from "@uniswap/v2-sdk";
import { logger } from "../logger/logger";
import {
  RPC_URL,
  PRIVATE_KEY,
  UNISWAP_V2_ROUTER_ADDRESS,
  UNISWAP_V2_FACTORY_ADDRESS,
} from "../config/env";

// ---------------------------------------------------------------------------
// ABI Definitions
// ---------------------------------------------------------------------------
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address recipient, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const UNISWAP_ROUTER_ABI = [
  "function swapTokensForExactTokens(uint amountOut, uint maxAmountIn, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const UNISWAP_PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];

const ERC1155_ABI = [
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
];

// ---------------------------------------------------------------------------
// Provider and Wallet Helpers
// ---------------------------------------------------------------------------
/**
 * Returns an ethers JSON-RPC provider instance.
 *
 * @returns {ethers.providers.JsonRpcProvider} An ethers provider.
 */
export const getProvider = () => new ethers.providers.JsonRpcProvider(RPC_URL);

/**
 * Returns an ethers Wallet instance using the provided private key.
 *
 * @returns {ethers.Wallet} An ethers Wallet instance.
 */
const getWallet = () => {
  const provider = getProvider();
  return new ethers.Wallet(PRIVATE_KEY, provider);
};

/**
 * Returns the current block number from the provider.
 *
 * @returns {Promise<number>} A promise that resolves to the current block number.
 */
export async function getBlockNumber(): Promise<number> {
  const provider = getProvider();
  return provider.getBlockNumber();
}

/**
 * Gets the contract address from the DDO.
 *
 * @param {any} ddo - The DDO.
 * @returns {string} The contract address.
 */
export function getContractAddress(ddo: any): string {
  return ddo.service[2].attributes.serviceAgreementTemplate.conditions
    .find((c: any) => c.name === "transferNFT")
    ?.parameters.find((p: any) => p.name === "_contractAddress")?.value;
}

/**
 * Gets the creator wallet from the DDO.
 *
 * @param {any} ddo - The DDO.
 * @returns {string} The creator wallet.
 */
export function getCreatorWallet(ddo: any): string {
  return ddo.service[2].attributes.main.creator;
}

/**
 * Gets the parameters needed to search for the burn of an ERC1155 NFT from the plan DID and the step.
 *
 * @param {any} payments - Payments instance.
 * @param {string} planDid - DID of the plan.
 * @returns {Promise<{ contractAddress: string, fromWallet: string, operator: string, tokenId: string | number, creatorWallet: string } | undefined>}
 */
export async function getBurnParamsForPlan(payments: any, planDid: string) {
  const ddo = await payments.getAssetDDO(planDid);
  const contractAddress = getContractAddress(ddo);
  const creatorWallet = getCreatorWallet(ddo);
  const operator = "0x5838B5512cF9f12FE9f2beccB20eb47211F9B0bc";
  const fromWallet = "0xaE61638CE22c375D21B113C3370FD9c1128a8DDf";
  const tokenId = BigInt(planDid.replace("did:nv:", "")).toString();

  if (contractAddress && fromWallet && tokenId !== undefined) {
    return {
      contractAddress,
      fromWallet,
      operator,
      tokenId,
      creatorWallet,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Token Helper Functions
// ---------------------------------------------------------------------------
/**
 * Retrieves token details from an ERC20 contract and returns a Uniswap SDK Token instance.
 *
 * @param {string} tokenAddress - The token contract address.
 * @param {number} networkId - The network ID.
 * @returns {Promise<Token>} A promise that resolves to a Uniswap SDK Token instance.
 */
export async function getTokenData(
  tokenAddress: string,
  networkId: number
): Promise<Token> {
  const provider = getProvider();
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  const [decimals, symbol, name] = await Promise.all([
    tokenContract.decimals(),
    tokenContract.symbol(),
    tokenContract.name(),
  ]);
  return new Token(networkId, tokenAddress, decimals, symbol, name);
}

/**
 * Retrieves the token balance for a given wallet as a BigNumber.
 *
 * @param {string} tokenAddress - The token contract address.
 * @param {string} walletAddress - The wallet address to query.
 * @returns {Promise<BigNumber>} A promise that resolves to the token balance.
 */
export async function getTokenBalance(
  tokenAddress: string,
  walletAddress: string
): Promise<BigNumber> {
  const provider = getProvider();
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  return tokenContract.balanceOf(walletAddress);
}

/**
 * Checks if a wallet's token balance is sufficient for the required amount.
 * Uses ethers' parseUnits to compute the required value.
 *
 * @param {string} tokenAddress - The token contract address.
 * @param {string} walletAddress - The wallet address to query.
 * @param {string} requiredAmount - The required token amount (in human-readable format).
 * @returns {Promise<boolean>} A promise that resolves to true if the balance is sufficient, false otherwise.
 */
export async function isBalanceSufficient(
  tokenAddress: string,
  walletAddress: string,
  requiredAmount: string
): Promise<boolean> {
  const provider = getProvider();
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  const decimals: number = await tokenContract.decimals();
  const balance: BigNumber = await tokenContract.balanceOf(walletAddress);
  const requiredBN = ethers.utils.parseUnits(requiredAmount, decimals);
  return balance.gte(requiredBN);
}

// ---------------------------------------------------------------------------
// Transfer Function
// ---------------------------------------------------------------------------
/**
 * Transfers the entire token balance from the signer's wallet to the specified agent wallet.
 *
 * @param {string} tokenAddress - The token contract address.
 * @param {Signer} signer - An ethers Signer instance controlling the wallet.
 * @param {string} agentWallet - The destination agent wallet address.
 * @param {amount} amount - The amount to transfer (in smallest units).
 * @param {number} [nonce] - Optional nonce to use for the transaction.
 * @returns {Promise<{ success: boolean, txHash?: string }>} A promise that resolves to an object containing the success flag and the transfer transaction hash if applicable.
 */
export async function transferAmountToAgentWallet(
  tokenAddress: string,
  signer: Signer,
  agentWallet: string,
  amount: string,
  nonce?: number
): Promise<{ success: boolean; txHash?: string }> {
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
  const walletAddress = await signer.getAddress();
  const balance: BigNumber = await tokenContract.balanceOf(walletAddress);

  if (balance.lt(amount)) {
    logger.info(`Insufficient funds to transfer from ${walletAddress}.`);
    return { success: false };
  }
  const amountBN = ethers.utils.parseUnits(
    amount,
    await tokenContract.decimals()
  );

  /**
   * If nonce is provided, use it in the transaction options.
   */
  const txOptions = nonce !== undefined ? { nonce } : {};
  const tx = await tokenContract.transfer(agentWallet, amountBN, txOptions);
  await tx.wait();
  logger.info(
    `Transferred ${amount.toString()} tokens from ${walletAddress} to agent wallet ${agentWallet}.`
  );
  return { success: true, txHash: tx.hash };
}

// ---------------------------------------------------------------------------
// Uniswap Helper Functions
// ---------------------------------------------------------------------------
/**
 * Retrieves the Uniswap pair address for the provided tokens.
 *
 * @param {Token} tokenA - The first token.
 * @param {Token} tokenB - The second token.
 * @param {ethers.providers.Provider} provider - The ethers provider.
 * @returns {Promise<string>} A promise that resolves to the Uniswap pair address.
 */
async function getPairAddress(
  tokenA: Token,
  tokenB: Token,
  provider: ethers.providers.Provider
): Promise<string> {
  const factory = new Contract(
    UNISWAP_V2_FACTORY_ADDRESS,
    FACTORY_ABI,
    provider
  );
  const [token0, token1] = tokenA.sortsBefore(tokenB)
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
  return factory.getPair(token0.address, token1.address);
}

/**
 * Creates a Uniswap Pair instance by fetching reserves from the pair contract.
 *
 * @param {string} pairAddress - The address of the Uniswap pair contract.
 * @param {Token} tokenA - The first token.
 * @param {Token} tokenB - The second token.
 * @param {ethers.providers.Provider} provider - The ethers provider.
 * @returns {Promise<Pair>} A promise that resolves to a Pair instance.
 */
async function getPairInstance(
  pairAddress: string,
  tokenA: Token,
  tokenB: Token,
  provider: ethers.providers.Provider
): Promise<Pair> {
  const pairContract = new Contract(pairAddress, UNISWAP_PAIR_ABI, provider);
  const reserves = await pairContract.getReserves();
  const [token0, token1] = tokenA.sortsBefore(tokenB)
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
  const reserve0 = CurrencyAmount.fromRawAmount(
    token0,
    reserves.reserve0.toString()
  );
  const reserve1 = CurrencyAmount.fromRawAmount(
    token1,
    reserves.reserve1.toString()
  );
  return new Pair(reserve0, reserve1);
}

// ---------------------------------------------------------------------------
// Main Swap Function
// ---------------------------------------------------------------------------
/**
 * Performs a token swap using Uniswap V2 from our token to an external token.
 * After a successful swap, it transfers all swapped tokens to the agent's wallet.
 *
 * @param {string} requiredAmount - The required external token amount in smallest units.
 * @param {string} ourTokenAddress - The address of our token.
 * @param {string} externalTokenAddress - The address of the external token.
 * @param {string} agentWallet - The agent's wallet address.
 * @param {number} networkId - The network ID.
 * @returns {Promise<{ success: boolean, swapTxHash?: string, transferTxHash?: string }>} A promise that resolves to an object containing the success flag and the transaction hashes for the swap and transfer operations.
 */
export async function performSwapForPlan(
  requiredAmount: string,
  ourTokenAddress: string,
  externalTokenAddress: string,
  agentWallet: string,
  networkId: number
): Promise<{ success: boolean; swapTxHash?: string; transferTxHash?: string }> {
  try {
    const provider = getProvider();
    const wallet = getWallet();

    // Fetch token data concurrently.
    const [ourToken, extToken] = await Promise.all([
      getTokenData(ourTokenAddress, networkId),
      getTokenData(externalTokenAddress, networkId),
    ]);

    // Create the desired output amount.
    const amountOut = CurrencyAmount.fromRawAmount(extToken, requiredAmount);

    // Retrieve Uniswap pair address and instance.
    const pairAddress = await getPairAddress(ourToken, extToken, provider);
    const pairInstance = await getPairInstance(
      pairAddress,
      ourToken,
      extToken,
      provider
    );

    // Build the trade route.
    const route = new Route([pairInstance], ourToken, extToken);

    // Create a trade for EXACT_OUTPUT.
    const trade = new Trade(route, amountOut, TradeType.EXACT_OUTPUT);
    const slippageTolerance = new Percent("100", "10000"); // 1%
    const maxAmountIn = trade
      .maximumAmountIn(slippageTolerance)
      .quotient.toString();

    // Get the current nonce from the network (pending state)
    let nonce = await provider.getTransactionCount(
      await wallet.getAddress(),
      "pending"
    );

    // Approve the router to spend our token, using the current nonce
    const ourTokenContract = new Contract(ourToken.address, ERC20_ABI, wallet);
    /**
     * Manually set the nonce for the approve transaction.
     */
    const approveTx = await ourTokenContract.approve(
      UNISWAP_V2_ROUTER_ADDRESS,
      maxAmountIn,
      { nonce }
    );
    await approveTx.wait();
    nonce++;

    // Execute the swap, using the incremented nonce
    const router = new Contract(
      UNISWAP_V2_ROUTER_ADDRESS,
      UNISWAP_ROUTER_ABI,
      wallet
    );
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    /**
     * Manually set the nonce for the swap transaction.
     */
    const swapTx = await router.swapTokensForExactTokens(
      requiredAmount,
      maxAmountIn,
      [ourToken.address, extToken.address],
      await wallet.getAddress(),
      deadline,
      { nonce }
    );
    await swapTx.wait();
    logger.info(`Swap completed successfully with TX hash: ${swapTx.hash}`);
    nonce++;

    // Transfer all swapped tokens to the agent wallet, using the incremented nonce
    /**
     * Manually set the nonce for the transfer transaction inside the helper.
     * We need to update transferAmountToAgentWallet to accept a nonce.
     */
    const transferResult = await transferAmountToAgentWallet(
      extToken.address,
      wallet,
      agentWallet,
      requiredAmount,
      nonce // Pass the nonce to the transfer function
    );

    return {
      success: true,
      swapTxHash: swapTx.hash,
      transferTxHash: transferResult.txHash,
    };
  } catch (error: any) {
    logger.error(
      `Swap error: ${error instanceof Error ? error.message : error}`
    );
    throw error; // Throw the error so retryOperation can retry
  }
}

/**
 * Busca eventos de burn históricos de un ERC1155 (TransferSingle a address(0)) para un usuario y token específico.
 *
 * @param {string} contractAddress - Dirección del contrato ERC1155
 * @param {string} fromWallet - Wallet que tenía el NFT
 * @param {string} operator - Dirección que ejecutó el burn (proxy)
 * @param {string|number} tokenId - Token ID del NFT
 * @param {number|string} fromBlock - Bloque desde el que buscar (por defecto 0)
 * @param {number|string} toBlock - Bloque hasta el que buscar (por defecto 'latest')
 * @returns {Promise<Array>} - Lista de transacciones de burn encontradas
 */
export async function findERC1155Burns(
  contractAddress: string,
  fromWallet: string,
  operator: string,
  tokenId: string | number,
  fromBlock: number | string = 0,
  toBlock: number | string = "latest"
): Promise<Array<any>> {
  const provider = getProvider();
  const contract = new Contract(contractAddress, ERC1155_ABI, provider);
  const burnAddress = "0x0000000000000000000000000000000000000000";
  const filter = contract.filters.TransferSingle(
    operator,
    fromWallet,
    burnAddress,
    tokenId
  );
  const events = await contract.queryFilter(filter, fromBlock, toBlock);
  return events.map((ev) => {
    const args = ev.args;
    const hasArgs =
      args &&
      typeof args === "object" &&
      "operator" in args &&
      "from" in args &&
      "to" in args &&
      "id" in args &&
      "value" in args;
    return {
      txHash: ev.transactionHash,
      blockNumber: ev.blockNumber,
      operator: hasArgs ? args.operator : undefined,
      from: hasArgs ? args.from : undefined,
      to: hasArgs ? args.to : undefined,
      tokenId: hasArgs ? args.id.toString() : undefined,
      value: hasArgs ? args.value.toString() : undefined,
    };
  });
}
