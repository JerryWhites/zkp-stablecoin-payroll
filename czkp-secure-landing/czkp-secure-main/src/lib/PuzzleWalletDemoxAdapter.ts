import { logger } from "@/lib/logger";
/**
 * PuzzleWalletDemoxAdapter
 * 
 * Compatibility wrapper that makes the @provablehq PuzzleWalletAdapter work
 * with the @demox-labs WalletProvider. The two libraries have incompatible interfaces:
 * 
 * - demox WalletProvider calls:  adapter.connect(decryptPermission, network, programs)
 * - provable PuzzleAdapter expects: adapter.connect(network, decryptPermission, programs)
 * 
 * - demox uses WalletAdapterNetwork enum:  "testnet3" | "testnetbeta" | "mainnetbeta"
 * - provable uses Network enum:            "testnet" | "mainnet" | "canary"
 * 
 * - demox uses requestTransaction(AleoTransaction) -> string
 * - provable uses executeTransaction(TransactionOptions) -> { transactionId }
 * 
 * This adapter bridges those differences so Puzzle Wallet works in the demox modal UI.
 * It also exposes Puzzle-native methods (getRecords, requestCreateEvent, getBalance)
 * for private record scanning and private transfers.
 */

import { PuzzleWalletAdapter, PUZZLE_NETWORK_MAP, type PuzzleWalletAdapterConfig } from "@provablehq/aleo-wallet-adaptor-puzzle";
import { Network } from "@provablehq/aleo-types";
import { WalletDecryptPermission } from "@provablehq/aleo-wallet-standard";
import {
  getRecords,
  getBalance,
  requestCreateEvent,
  type GetRecordsRequest,
  type GetRecordsResponse,
  type GetBalancesResponse,
  type CreateEventRequestData,
  type CreateEventResponse,
} from "@puzzlehq/sdk-core";
import {
  EventType,
  RecordStatus,
  Network as PuzzleNetwork,
  type RecordWithPlaintext,
} from "@puzzlehq/types";
import {
  type WalletAdapterEvents,
  type WalletName,
  WalletReadyState,
  EventEmitter,
  scopePollingDetectionStrategy,
} from "@demox-labs/aleo-wallet-adapter-base";
import type {
  DecryptPermission,
  WalletAdapterNetwork,
  AleoTransaction,
} from "@demox-labs/aleo-wallet-adapter-base";

// Map demox WalletAdapterNetwork values -> provable Network values
const NETWORK_MAP: Record<string, Network> = {
  "testnet3": Network.TESTNET,
  "testnetbeta": Network.TESTNET,
  "mainnetbeta": Network.MAINNET,
  // Also support provable values if passed directly
  "testnet": Network.TESTNET,
  "mainnet": Network.MAINNET,
  "canary": Network.CANARY,
};

// Map demox DecryptPermission string values -> provable WalletDecryptPermission
const DECRYPT_PERMISSION_MAP: Record<string, WalletDecryptPermission> = {
  "NO_DECRYPT": WalletDecryptPermission.NoDecrypt,
  "DECRYPT_UPON_REQUEST": WalletDecryptPermission.UponRequest,
  "AUTO_DECRYPT": WalletDecryptPermission.AutoDecrypt,
  "ON_CHAIN_HISTORY": WalletDecryptPermission.OnChainHistory,
};

export class PuzzleWalletDemoxAdapter extends EventEmitter<WalletAdapterEvents> {
  // Demox adapter interface properties
  name = "Puzzle Wallet" as WalletName<"Puzzle Wallet">;
  url = "https://puzzle.online/wallet";
  icon: string;
  
  private _puzzle: PuzzleWalletAdapter;
  private _publicKey: string | null = null;
  private _connecting = false;
  private _connectedNetwork: Network = Network.TESTNET;
  
  readonly supportedTransactionVersions = null;

  /** Whether this adapter is the Puzzle compatibility wrapper (used for feature detection) */
  readonly isPuzzleAdapter = true;

  constructor(config?: PuzzleWalletAdapterConfig) {
    super();
    this._puzzle = new PuzzleWalletAdapter(config);
    this.icon = this._puzzle.icon;

    // Proxy events from the underlying Puzzle adapter
    this._puzzle.on("connect" as any, (account: any) => {
      const address = typeof account === "string" ? account : account?.address ?? "";
      this._publicKey = address;
      this.emit("connect", address);
    });

    this._puzzle.on("disconnect" as any, () => {
      this._publicKey = null;
      this.emit("disconnect");
    });

    this._puzzle.on("error" as any, (error: any) => {
      this.emit("error", error);
    });

    this._puzzle.on("readyStateChange" as any, (state: any) => {
      this.emit("readyStateChange", this.readyState);
    });
  }

  get publicKey(): string | null {
    return this._publicKey ?? this._puzzle.account?.address ?? null;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return this._puzzle.connected;
  }

  get readyState(): WalletReadyState {
    // provable WalletReadyState uses same string values as demox
    return this._puzzle.readyState as unknown as WalletReadyState;
  }

  set readyState(state: WalletReadyState) {
    // The underlying adapter manages this via polling
  }

  /**
   * Connect - called by demox WalletProvider as:
   *   adapter.connect(decryptPermission, network, programs)
   * 
   * We translate and forward to the provable PuzzleWalletAdapter as:
   *   puzzleAdapter.connect(network, decryptPermission, programs)
   */
  async connect(
    decryptPermission: DecryptPermission,
    network: WalletAdapterNetwork,
    programs?: string[]
  ): Promise<void> {
    if (this._connecting) return;
    this._connecting = true;

    try {
      // Map demox network value to provable Network enum
      const mappedNetwork = NETWORK_MAP[network as string] ?? Network.TESTNET;
      
      // Map demox DecryptPermission to provable WalletDecryptPermission
      const mappedPermission =
        DECRYPT_PERMISSION_MAP[decryptPermission as string] ??
        WalletDecryptPermission.AutoDecrypt;

      logger.log("[PuzzleDemoxAdapter] connect", {
        demoxNetwork: network,
        mappedNetwork,
        demoxDecrypt: decryptPermission,
        mappedPermission,
        programs,
      });

      // Call provable adapter with correct parameter order: (network, decryptPermission, programs)
      const account = await this._puzzle.connect(
        mappedNetwork,
        mappedPermission,
        programs
      );

      this._publicKey = account?.address ?? null;
      this._connectedNetwork = mappedNetwork;
      
      // The provable adapter emits 'connect' with Account object,
      // but we also emit here in demox format (string publicKey)
      // in case the proxy event didn't fire
      if (this._publicKey) {
        this.emit("connect", this._publicKey, programs);
      }
    } catch (error: any) {
      logger.error("[PuzzleDemoxAdapter] connect error:", error);
      this.emit("error", error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this._puzzle.disconnect();
    } catch (error: any) {
      // TRPC/connection errors during disconnect are expected when
      // the Puzzle extension background process isn't reachable
      const msg = error?.message || String(error);
      if (msg.includes('No connection') || msg.includes('TRPC') || msg.includes('hostname')) {
        logger.log("[PuzzleDemoxAdapter] disconnect: extension not reachable (safe to ignore)");
      } else {
        logger.error("[PuzzleDemoxAdapter] disconnect error:", error);
      }
    } finally {
      this._publicKey = null;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return this._puzzle.signMessage(message);
  }

  async decrypt(
    cipherText: string,
    tpk?: string,
    programId?: string,
    functionName?: string,
    index?: number
  ): Promise<string> {
    // The provable PuzzleWalletAdapter.decrypt only accepts cipherText
    return this._puzzle.decrypt(cipherText);
  }

  async requestRecords(program: string): Promise<any[]> {
    return this._puzzle.requestRecords(program) as Promise<any[]>;
  }

  /**
   * requestTransaction - demox interface
   * Converts AleoTransaction to provable TransactionOptions and calls executeTransaction.
   * 
   * For private transfers: The Puzzle adapter internally calls requestCreateEvent
   * which accepts RecordWithPlaintext objects. When inputs contain record objects
   * (rawRecord from getPrivateRecords), we pass them through for proper ZKP handling.
   */
  async requestTransaction(transaction: AleoTransaction): Promise<string> {
    if (!transaction.transitions || transaction.transitions.length === 0) {
      throw new Error("Transaction must have at least one transition");
    }

    const transition = transaction.transitions[0];
    
    // Properly serialize inputs — record objects must become their plaintext string,
    // not "[object Object]" from String(obj)
    const serializedInputs = transition.inputs.map((input: any) => {
      if (typeof input === 'string') return input;
      // RecordWithPlaintext or similar record objects have a .plaintext property
      if (input?.plaintext && typeof input.plaintext === 'string') return input.plaintext;
      // Other objects — JSON serialize as last resort
      if (typeof input === 'object' && input !== null) {
        try { return JSON.stringify(input); } catch { /* fall through */ }
      }
      return String(input);
    });

    logger.log("[PuzzleDemoxAdapter] requestTransaction inputs:", serializedInputs.map((s: string) => s.substring(0, 60)));

    const result = await this._puzzle.executeTransaction({
      program: transition.program,
      function: transition.functionName,
      inputs: serializedInputs,
      fee: transaction.fee,
      privateFee: transaction.feePrivate,
    });

    return result.transactionId;
  }

  // ──────────────────────────────────────────────────────────
  //  Puzzle-native SDK methods for private record handling
  //  These are NOT part of the demox adapter interface, but
  //  are exposed for direct use when Puzzle wallet is selected.
  // ──────────────────────────────────────────────────────────

  /** Get the Puzzle SDK network enum for the connected session */
  private get _puzzleNetwork(): PuzzleNetwork {
    return PUZZLE_NETWORK_MAP[this._connectedNetwork] ?? PuzzleNetwork.AleoTestnet;
  }

  /**
   * Fetch private credit records directly from the Puzzle SDK.
   * Returns full RecordWithPlaintext objects needed for transfer_private.
   */
  async getPrivateRecords(programId: string = "credits.aleo", status: "Unspent" | "All" = "Unspent"): Promise<RecordWithPlaintext[]> {
    if (!this._publicKey) throw new Error("Wallet not connected");

    const allRecords: RecordWithPlaintext[] = [];
    let page = 0;
    let totalPages = 1;

    // Paginate through all record pages
    while (page < totalPages) {
      const response: GetRecordsResponse = await getRecords({
        filter: {
          programIds: [programId],
          status: status === "All" ? "All" : RecordStatus.Unspent,
        },
        page,
        address: this._publicKey,
        network: this._puzzleNetwork,
      });

      allRecords.push(...response.records);
      totalPages = response.pageCount;
      page++;
    }

    logger.log(`[PuzzleDemoxAdapter] getPrivateRecords(${programId}): ${allRecords.length} records found`);
    return allRecords;
  }

  /**
   * Get wallet balance (both private and public) from Puzzle SDK.
   */
  async getWalletBalance(): Promise<{ private: number; public: number }> {
    if (!this._publicKey) throw new Error("Wallet not connected");

    try {
      const response: GetBalancesResponse = await getBalance({
        address: this._publicKey,
        network: this._puzzleNetwork,
      });

      // Find credits.aleo balance
      const creditsBalance = response.balances.find(
        (b: any) => b.programId === "credits.aleo" || b.tokenId === "credits.aleo"
      );

      if (creditsBalance) {
        return {
          private: creditsBalance.values?.private ?? 0,
          public: creditsBalance.values?.public ?? 0,
        };
      }

      return { private: 0, public: 0 };
    } catch (e) {
      logger.error("[PuzzleDemoxAdapter] getWalletBalance error:", e);
      return { private: 0, public: 0 };
    }
  }

  /**
   * Execute a private transfer using the Puzzle SDK's requestCreateEvent directly.
   * This allows passing RecordWithPlaintext objects as inputs, which is required
   * for credits.aleo transfer_private (ZKP private-to-private transfer).
   * 
   * @param record - The full RecordWithPlaintext to spend (from getPrivateRecords)
   * @param toAddress - Recipient aleo1... address 
   * @param amountMicrocredits - Amount in microcredits (u64)
   * @param fee - Network fee in microcredits (default 250_000 = 0.25 ALEO)
   * @returns The event/transaction ID
   */
  async transferPrivate(
    record: RecordWithPlaintext,
    toAddress: string,
    amountMicrocredits: number,
    fee: number = 250_000,
  ): Promise<string> {
    if (!this._publicKey) throw new Error("Wallet not connected");

    logger.log("[PuzzleDemoxAdapter] transferPrivate", {
      from: this._publicKey,
      to: toAddress,
      amount: amountMicrocredits,
      recordMicrocredits: record.microcredits,
      fee,
    });

    // Use requestCreateEvent directly so we can pass the RecordWithPlaintext object.
    // The Puzzle SDK serializes this properly for ZK proof generation.
    const result: CreateEventResponse = await requestCreateEvent({
      type: EventType.Execute,
      programId: "credits.aleo",
      functionId: "transfer_private",
      fee: fee / 1_000_000, // SDK expects fee in whole credits, not microcredits
      inputs: [
        record,                              // RecordWithPlaintext (the UTXO to spend)
        toAddress,                           // address (private)
        `${amountMicrocredits}u64`,          // amount (private)
      ],
      address: this._publicKey,
      network: this._puzzleNetwork,
    });

    if (result.error) {
      throw new Error(`Private transfer failed: ${result.error}`);
    }

    if (!result.eventId) {
      throw new Error("Private transfer failed: no event ID returned");
    }

    logger.log(`[PuzzleDemoxAdapter] transferPrivate success: ${result.eventId}`);
    return result.eventId;
  }

  /**
   * Get the status of an event/transaction.
   * Uses the Puzzle SDK's getEvent internally via the provable adapter.
   */
  async getEventStatus(eventId: string): Promise<{ status: string; transactionId?: string }> {
    try {
      const result = await this._puzzle.transactionStatus(eventId);
      return {
        status: result?.status ?? "unknown",
        transactionId: (result as any)?.transactionId,
      };
    } catch (e) {
      return { status: "unknown" };
    }
  }

  /**
   * requestExecution - demox interface (same as requestTransaction for Puzzle)
   */
  async requestExecution(transaction: AleoTransaction): Promise<string> {
    return this.requestTransaction(transaction);
  }

  async requestBulkTransactions(transactions: AleoTransaction[]): Promise<string[]> {
    const results: string[] = [];
    for (const tx of transactions) {
      const txId = await this.requestTransaction(tx);
      results.push(txId);
    }
    return results;
  }

  async transactionStatus(transactionId: string): Promise<string> {
    const result = await this._puzzle.transactionStatus(transactionId);
    return result?.status ?? "unknown";
  }

  async requestRecordPlaintexts(program: string): Promise<any[]> {
    // Puzzle adapter uses requestRecords
    return this._puzzle.requestRecords(program) as Promise<any[]>;
  }

  async requestTransactionHistory(program: string): Promise<any[]> {
    try {
      const result = await this._puzzle.requestTransactionHistory(program);
      return result?.transactions ?? [];
    } catch {
      return [];
    }
  }

  // Deployment support
  async requestDeploy(deployment: any): Promise<string> {
    const result = await this._puzzle.executeDeployment(deployment);
    return result.transactionId;
  }

  async transitionViewKeys(transactionId: string): Promise<string[]> {
    return this._puzzle.transitionViewKeys(transactionId);
  }

  async getExecution(transactionId: string): Promise<string> {
    // Not directly supported by Puzzle adapter
    throw new Error("getExecution is not supported by Puzzle Wallet");
  }
}

// Re-export Puzzle SDK types that PayrollApp needs for private transfers
export type { RecordWithPlaintext } from "@puzzlehq/types";
export { RecordStatus } from "@puzzlehq/types";
