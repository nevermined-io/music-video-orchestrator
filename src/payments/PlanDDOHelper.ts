/**
 * Helper class to extract and cache plan DDO data and provide utility methods.
 */
export class PlanDDOHelper {
  public payments: any;
  private ddo: any | undefined;

  planDid: string;

  /**
   * @param payments - Instance of payments library
   * @param planDid - DID of the plan
   */
  constructor(payments: any, planDid: string) {
    this.payments = payments;
    this.planDid = planDid;
    this.ddo = undefined;
  }

  /**
   * Loads the DDO for the plan (if not already loaded)
   * @returns {Promise<any>} The loaded DDO object
   */
  async loadDDO() {
    if (!this.ddo) {
      this.ddo = await this.payments.getAssetDDO(this.planDid);
    }
    return this.ddo;
  }

  /**
   * Gets the ERC20 token address from the DDO
   * @returns {Promise<string | undefined>} The ERC20 token address
   */
  async getTokenAddress(): Promise<string | undefined> {
    const ddo = await this.loadDDO();
    return ddo?.service?.[2]?.attributes?.additionalInformation
      ?.erc20TokenAddress;
  }

  /**
   * Gets the ERC20 token symbol from the DDO
   * @returns {Promise<string | undefined>} The ERC20 token symbol
   */
  async getTokenName(): Promise<string | undefined> {
    const ddo = await this.loadDDO();
    return ddo?.service?.[2]?.attributes?.additionalInformation?.symbol;
  }

  /**
   * Gets the plan price from the DDO
   * @returns {Promise<string>} The plan price
   */
  async getPlanPrice(): Promise<string> {
    const ddo = await this.loadDDO();
    return (
      ddo?.service?.[2]?.attributes?.additionalInformation?.priceHighestDenomination?.toString() ||
      "0"
    );
  }

  /**
   * Gets the agent wallet from the DDO
   * @returns {Promise<string | undefined>} The agent wallet address
   */
  async getAgentWallet(): Promise<string | undefined> {
    const ddo = await this.loadDDO();
    return ddo?.publicKey?.[0]?.owner;
  }

  /**
   * Gets the NFT1155 contract address from the DDO (from parameters)
   * @returns {Promise<string | undefined>} The NFT1155 contract address
   */
  async get1155ContractAddress(): Promise<string | undefined> {
    const ddo = await this.loadDDO();
    const params =
      ddo?.service?.[2]?.attributes?.serviceAgreementTemplate?.conditions.find(
        (c: any) => c.name === "transferNFT"
      )?.parameters;
    if (Array.isArray(params)) {
      const param = params.find((p: any) => p.name === "_contractAddress");
      return param?.value;
    }
    return undefined;
  }

  /**
   * Gets the tokenId for the plan (from the planDid, as decimal string)
   * @returns {Promise<string>} The tokenId as a string
   */
  async getTokenId(): Promise<string> {
    return BigInt("0x" + this.planDid.replace("did:nv:", "")).toString();
  }

  /**
   * Gets the mint contract address from the DDO
   * @returns {Promise<string | undefined>} The mint contract address
   */
  async getMintOperator(): Promise<string | undefined> {
    return "0xd596661b11Ba7EaCA074fA59247e342214Db4D5A";
  }

  /**
   * Gets the operator from the DDO
   * @returns {Promise<string | undefined>} The operator address
   */
  async getBurnOperator(): Promise<string | undefined> {
    return "0x5838B5512cF9f12FE9f2beccB20eb47211F9B0bc";
  }
}
