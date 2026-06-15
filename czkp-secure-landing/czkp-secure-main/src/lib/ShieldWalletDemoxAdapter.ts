import { logger } from "@/lib/logger";
/**
 * ShieldWalletDemoxAdapter
 * 
 * Compatibility wrapper that makes the @provablehq ShieldWalletAdapter work
 * with the @demox-labs WalletProvider. The two libraries have incompatible interfaces:
 * 
 * - demox WalletProvider calls:  adapter.connect(decryptPermission, network, programs)
 * - provable ShieldAdapter expects: adapter.connect(network, decryptPermission, programs)
 * 
 * - demox uses WalletAdapterNetwork enum:  "testnet3" | "testnetbeta" | "mainnetbeta"
 * - provable uses Network enum:            "testnet" | "mainnet" | "canary"
 * 
 * - demox uses requestTransaction(AleoTransaction) -> string
 * - provable uses executeTransaction(TransactionOptions) -> { transactionId }
 * 
 * This adapter bridges those differences so Shield Wallet works in the demox modal UI.
 */

import { ShieldWalletAdapter, type ShieldWalletAdapterConfig } from "@provablehq/aleo-wallet-adaptor-shield";
import { Network } from "@provablehq/aleo-types";
import { WalletDecryptPermission } from "@provablehq/aleo-wallet-standard";
import {
  type WalletAdapterEvents,
  type WalletName,
  WalletReadyState,
  EventEmitter,
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

export class ShieldWalletDemoxAdapter extends EventEmitter<WalletAdapterEvents> {
  // Demox adapter interface properties
  name = "Shield Wallet" as WalletName<"Shield Wallet">;
  url = "https://www.shield.app/";
  icon: string;
  
  private _shield: ShieldWalletAdapter;
  private _publicKey: string | null = null;
  private _connecting = false;
  private _connectedNetwork: Network = Network.TESTNET;
  
  readonly supportedTransactionVersions = null;

  /** Whether this adapter is the Shield compatibility wrapper (used for feature detection) */
  readonly isShieldAdapter = true;

  constructor(config?: ShieldWalletAdapterConfig) {
    super();
    this._shield = new ShieldWalletAdapter(config);
    this.icon = this._shield.icon;

    // Proxy events from the underlying Shield adapter
    this._shield.on("connect" as any, (account: any) => {
      const address = typeof account === "string" ? account : account?.address ?? "";
      this._publicKey = address;
      this.emit("connect", address);
    });

    this._shield.on("disconnect" as any, () => {
      this._publicKey = null;
      this.emit("disconnect");
    });

    this._shield.on("error" as any, (error: any) => {
      this.emit("error", error);
    });

    this._shield.on("readyStateChange" as any, (state: any) => {
      this.emit("readyStateChange", this.readyState);
    });
  }

  get publicKey(): string | null {
    return this._publicKey ?? this._shield.account?.address ?? null;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return this._shield.connected;
  }

  get readyState(): WalletReadyState {
    // provable WalletReadyState uses same string values as demox
    return this._shield.readyState as unknown as WalletReadyState;
  }

  set readyState(state: WalletReadyState) {
    // The underlying adapter manages this via polling
  }

  /**
   * Connect - called by demox WalletProvider as:
   *   adapter.connect(decryptPermission, network, programs)
   * 
   * We translate and forward to the provable ShieldWalletAdapter as:
   *   shieldAdapter.connect(network, decryptPermission, programs)
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

      logger.log("[ShieldDemoxAdapter] connect", {
        demoxNetwork: network,
        mappedNetwork,
        demoxDecrypt: decryptPermission,
        mappedPermission,
        programs,
      });

      // Call provable adapter with correct parameter order: (network, decryptPermission, programs)
      const account = await this._shield.connect(
        mappedNetwork,
        mappedPermission,
        programs
      );

      this._publicKey = account?.address ?? null;
      this._connectedNetwork = mappedNetwork;
      
      // Emit in demox format (string publicKey)
      if (this._publicKey) {
        this.emit("connect", this._publicKey, programs);
      }
    } catch (error: any) {
      logger.error("[ShieldDemoxAdapter] connect error:", error);
      this.emit("error", error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this._shield.disconnect();
    } catch (error: any) {
      const msg = error?.message || String(error);
      if (msg.includes('No connection') || msg.includes('not available')) {
        logger.log("[ShieldDemoxAdapter] disconnect: wallet not reachable (safe to ignore)");
      } else {
        logger.error("[ShieldDemoxAdapter] disconnect error:", error);
      }
    } finally {
      this._publicKey = null;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    return this._shield.signMessage(message);
  }

  async decrypt(
    cipherText: string,
    tpk?: string,
    programId?: string,
    functionName?: string,
    index?: number
  ): Promise<string> {
    return this._shield.decrypt(cipherText);
  }

  async requestRecords(program: string): Promise<any[]> {
    // Shield's requestRecords supports an includePlaintext parameter
    return this._shield.requestRecords(program, true) as Promise<any[]>;
  }

  /**
   * requestTransaction - demox interface
   * Converts demox AleoTransaction to provable TransactionOptions and calls executeTransaction.
   */
  async requestTransaction(transaction: AleoTransaction): Promise<string> {
    if (!transaction.transitions || transaction.transitions.length === 0) {
      throw new Error("Transaction must have at least one transition");
    }

    const transition = transaction.transitions[0];
    
    // Properly serialize inputs — record objects must become their plaintext string
    const serializedInputs = transition.inputs.map((input: any) => {
      if (typeof input === 'string') return input;
      if (input?.plaintext && typeof input.plaintext === 'string') return input.plaintext;
      if (typeof input === 'object' && input !== null) {
        try { return JSON.stringify(input); } catch { /* fall through */ }
      }
      return String(input);
    });

    logger.log("[ShieldDemoxAdapter] requestTransaction inputs:", serializedInputs.map((s: string) => s.substring(0, 60)));

    const result = await this._shield.executeTransaction({
      program: transition.program,
      function: transition.functionName,
      inputs: serializedInputs,
      fee: transaction.fee,
      privateFee: transaction.feePrivate,
    });

    return result.transactionId;
  }

  /**
   * requestExecution - demox interface (same as requestTransaction for Shield)
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
    const result = await this._shield.transactionStatus(transactionId);
    return result?.status ?? "unknown";
  }

  async requestRecordPlaintexts(program: string): Promise<any[]> {
    return this._shield.requestRecords(program, true) as Promise<any[]>;
  }

  async requestTransactionHistory(program: string): Promise<any[]> {
    try {
      const result = await this._shield.requestTransactionHistory(program);
      return (result as any)?.transactions ?? [];
    } catch {
      return [];
    }
  }

  // Deployment support
  async requestDeploy(deployment: any): Promise<string> {
    const result = await this._shield.executeDeployment(deployment);
    return result.transactionId;
  }

  async transitionViewKeys(transactionId: string): Promise<string[]> {
    return this._shield.transitionViewKeys(transactionId);
  }

  async getExecution(transactionId: string): Promise<string> {
    throw new Error("getExecution is not supported by Shield Wallet");
  }
}
