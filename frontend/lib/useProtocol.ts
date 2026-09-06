/**
 * Everything the page reads from the chain, in one place.
 *
 * Handles are fetched eagerly; plaintext is not. A balance arrives as a
 * ciphertext handle and stays sealed until its holder asks to read it, which
 * is both the protocol's behaviour and the interface's central idea. Nothing
 * here decrypts on its own.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, JsonRpcProvider, type BrowserProvider } from "ethers";

import { ABI } from "./abi";
import { deployment, isDeployed, RPC_URL } from "./config";
import type { Connection } from "./wallet";

/** Mirrors `IDrawEngine.DrawState`. */
export enum DrawState {
  Open = 0,
  Sealed = 1,
  Selecting = 2,
  Settled = 3,
}

export interface DrawFacts {
  readonly drawId: bigint;
  readonly state: DrawState;
  readonly totalWeight: bigint;
  readonly prize: bigint;
  readonly participantCount: number;
  readonly tierCursor: number;
  readonly indexCursor: number;
  readonly tierCount: number;
  /**
   * Handle to the point the current tier is settling against.
   *
   * A handle, never a value: no ACL entry is issued for it by any contract, so
   * it cannot be decrypted by the operator, a participant, or this interface.
   * Shown only to make visible that a point exists and changes per tier.
   */
  readonly drawPointHandle: string;
}

export interface ProtocolState {
  /** Handle to the caller's confidential position, or null if they have none. */
  readonly balanceHandle: string | null;
  /** Handle to the caller's award for the latest settled draw. */
  readonly awardHandle: string | null;
  readonly awardIsPublic: boolean;
  readonly hasClaimed: boolean;

  readonly publishedPrincipal: bigint;
  /**
   * When that total was last snapshotted, in seconds. Zero if never.
   *
   * Carried because the figure is deliberately allowed to lag: snapshots are
   * rate-limited on-chain so they cannot be taken either side of a single
   * deposit. Without showing the age, a visitor who deposits and sees the
   * total sit still would read a working defence as a broken page.
   */
  readonly principalPublishedAt: number;
  readonly unallocatedPrize: bigint;
  readonly participantCount: number;

  readonly draw: DrawFacts | null;
}

const EMPTY: ProtocolState = {
  balanceHandle: null,
  awardHandle: null,
  awardIsPublic: false,
  hasClaimed: false,
  publishedPrincipal: 0n,
  principalPublishedAt: 0,
  unallocatedPrize: 0n,
  participantCount: 0,
  draw: null,
};

const ZERO_HANDLE = `0x${"0".repeat(64)}`;

export interface Contracts {
  readonly pool: Contract;
  readonly engine: Contract;
  readonly vault: Contract;
  readonly ledger: Contract;
  readonly disclosure: Contract;
  readonly token: Contract;
}

/**
 * The same contracts, bound to a plain RPC connection instead of a wallet.
 *
 * Only the aggregates are read through this — the total, the position count,
 * the state of a draw — and every one of them is public on-chain. Nothing
 * here can decrypt anything: reading a ciphertext still needs an ACL entry
 * and a signature, and this reader holds neither.
 */
export function buildPublicContracts(): Contracts {
  const runner = new JsonRpcProvider(RPC_URL, deployment.chainId, {
    // The chain is known and fixed, so there is nothing to discover and no
    // reason to spend a round trip discovering it.
    staticNetwork: true,
  });
  return {
    pool: new Contract(deployment.pool, ABI.ConfidentialPrizePool, runner),
    engine: new Contract(deployment.engine, ABI.DrawEngine, runner),
    vault: new Contract(deployment.vault, ABI.PrizeVault, runner),
    ledger: new Contract(deployment.ledger, ABI.TicketLedger, runner),
    disclosure: new Contract(deployment.disclosure, ABI.DisclosureRegistry, runner),
    token: new Contract(deployment.token, ABI.ConfidentialTokenMock, runner),
  };
}

export function buildContracts(connection: Connection): Contracts {
  const runner = connection.signer;
  return {
    pool: new Contract(deployment.pool, ABI.ConfidentialPrizePool, runner),
    engine: new Contract(deployment.engine, ABI.DrawEngine, runner),
    vault: new Contract(deployment.vault, ABI.PrizeVault, runner),
    ledger: new Contract(deployment.ledger, ABI.TicketLedger, runner),
    disclosure: new Contract(deployment.disclosure, ABI.DisclosureRegistry, runner),
    token: new Contract(deployment.token, ABI.ConfidentialTokenMock, runner),
  };
}

export function useProtocol(connection: Connection | null) {
  const [state, setState] = useState<ProtocolState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contracts = useMemo(
    () => (connection === null ? null : buildContracts(connection)),
    [connection],
  );

  // What the public half of the page is read through. A wallet, once there is
  // one; a bare RPC connection otherwise.
  const reader = useMemo(() => contracts ?? buildPublicContracts(), [contracts]);

  const refresh = useCallback(async () => {
    if (!isDeployed) {
      setState(EMPTY);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [publishedPrincipal, principalPublishedAt, unallocatedPrize, participantCount] =
        await Promise.all([
          reader.pool["publishedPrincipal"]!() as Promise<bigint>,
          reader.pool["lastDisclosureAt"]!() as Promise<bigint>,
          reader.vault["unallocatedPrize"]!() as Promise<bigint>,
          reader.ledger["participantCount"]!() as Promise<bigint>,
        ]);

      const drawId = (await reader.engine["currentDrawId"]!()) as bigint;
      const draw = drawId === 0n ? null : await readDraw(reader, drawId);

      // Everything from here needs an account to be about. Without one the
      // page shows the pool and stops, which is exactly what an onlooker is
      // entitled to see.
      let balanceHandle: string | null = null;
      let awardHandle: string | null = null;
      let awardIsPublic = false;
      let hasClaimed = false;

      if (connection !== null && contracts !== null) {
        const raw = (await contracts.pool["balanceOf"]!(connection.address)) as string;
        balanceHandle = raw === ZERO_HANDLE ? null : raw;

        if (drawId !== 0n) {
          const award = (await contracts.vault["awardOf"]!(
            drawId,
            connection.address,
          )) as string;
          awardHandle = award === ZERO_HANDLE ? null : award;

          if (awardHandle !== null) {
            const [visibility, claimed] = await Promise.all([
              contracts.disclosure["visibilityOf"]!(
                drawId,
                connection.address,
              ) as Promise<bigint>,
              contracts.vault["hasClaimed"]!(drawId, connection.address) as Promise<boolean>,
            ]);
            awardIsPublic = visibility === 1n;
            hasClaimed = claimed;
          }
        }
      }

      setState({
        balanceHandle,
        awardHandle,
        awardIsPublic,
        hasClaimed,
        publishedPrincipal,
        principalPublishedAt: Number(principalPublishedAt),
        unallocatedPrize,
        participantCount: Number(participantCount),
        draw,
      });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not read the pool.");
    } finally {
      setLoading(false);
    }
  }, [connection, contracts, reader]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, contracts, loading, error, refresh };
}

async function readDraw(contracts: Contracts, drawId: bigint): Promise<DrawFacts> {
  const [facts, pointHandle] = await Promise.all([
    contracts.engine["drawFacts"]!(drawId) as Promise<
      [bigint, bigint, bigint, bigint, bigint, bigint, bigint]
    >,
    contracts.engine["drawPointHandle"]!(drawId) as Promise<string>,
  ]);

  return {
    drawId,
    state: Number(facts[0]) as DrawState,
    totalWeight: facts[1],
    prize: facts[2],
    participantCount: Number(facts[3]),
    tierCursor: Number(facts[4]),
    indexCursor: Number(facts[5]),
    tierCount: Number(facts[6]),
    drawPointHandle: pointHandle,
  };
}

/** How far a draw has walked, as a fraction of the work it has to do. */
export function drawProgress(draw: DrawFacts): { done: number; total: number } {
  const perTier = draw.participantCount;
  const total = perTier * Math.max(1, draw.tierCount);
  const done = draw.tierCursor * perTier + draw.indexCursor;
  return { done, total };
}

export function describeDrawState(state: DrawState): string {
  switch (state) {
    case DrawState.Open:
      return "Open";
    case DrawState.Sealed:
      return "Sealed";
    case DrawState.Selecting:
      return "Selecting";
    case DrawState.Settled:
      return "Settled";
  }
}

export type { BrowserProvider };
