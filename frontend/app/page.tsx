"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AwardPanel,
  DrawPanel,
  type DrawStep,
  FaucetPanel,
  MovePanel,
  PoolPanel,
  PositionPanel,
  RulesPanel,
} from "@/components/panels";
import { Button, Group, Row, Status } from "@/components/primitives";
import { VantageSwitch, type Vantage } from "@/components/ObserverToggle";
import { UrnaScene, useScenePhase } from "@/components/UrnaScene";
import { Wordmark } from "@/components/Wordmark";
import { deployment, isDeployed, TOKEN_DECIMALS } from "@/lib/config";
import {
  decryptOwn,
  decryptPublic,
  decryptPublicWithProof,
  encryptAmount,
  resetAuthorisation,
  type TypedDataSigner,
} from "@/lib/fhevm";
import { shortAddress } from "@/lib/format";
import { DrawState, useDeploymentFacts, useProtocol } from "@/lib/useProtocol";
import {
  connect,
  hasWallet,
  readableError,
  restore,
  switchToDeploymentChain,
  type Connection,
} from "@/lib/wallet";

/** What the faucet hands out per click. */
const FAUCET_AMOUNT = 10_000n * 10n ** BigInt(TOKEN_DECIMALS);

export default function Page() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Which point of view the page is rendered from. Purely a display concern:
  // switching it changes nothing on-chain and reads nothing new. It exists
  // because confidentiality is otherwise invisible — a pool that hides
  // balances looks exactly like one that has none.
  const [vantage, setVantage] = useState<Vantage>("holder");

  // Whether a wallet is present can only be known in the browser, so it must
  // not be read during render: the server would say "no wallet", the client
  // might say otherwise, and the two renderings would disagree. Deferring it
  // to an effect means the first paint matches on both sides.
  const [walletDetected, setWalletDetected] = useState(false);
  useEffect(() => {
    setWalletDetected(hasWallet());

    // If the wallet already trusts this site, pick the connection back up
    // rather than asking again. A refresh should not cost someone their
    // session, and this asks nothing of them.
    void restore().then((existing) => {
      if (existing !== null) setConnection(existing);
    });
  }, []);

  const { state, contracts, refresh } = useProtocol(connection);
  const deploymentFacts = useDeploymentFacts();

  // Revealed plaintext lives in memory only, and is dropped whenever the
  // underlying handle changes. Persisting it anywhere would undo the point of
  // keeping the value sealed on-chain.
  const [revealedBalance, setRevealedBalance] = useState<bigint | null>(null);
  const [revealedAward, setRevealedAward] = useState<bigint | null>(null);

  useEffect(() => setRevealedBalance(null), [state.balanceHandle]);
  useEffect(() => setRevealedAward(null), [state.awardHandle]);

  const run = useCallback(
    async (label: string, action: () => Promise<string | void>) => {
      setBusy(label);
      setNotice(null);
      try {
        const message = await action();
        if (typeof message === "string") setNotice({ text: message, isError: false });
        await refresh();
      } catch (error: unknown) {
        setNotice({ text: readableError(error), isError: true });
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const onConnect = useCallback(async () => {
    setNotice(null);
    try {
      const next = await connect();
      resetAuthorisation();
      setConnection(next);
      if (next.chainId !== deployment.chainId) {
        setNotice({
          text: `Wallet is on chain ${next.chainId}. Switch to ${deployment.chainName} to continue.`,
          isError: true,
        });
      }
    } catch (error: unknown) {
      setNotice({ text: readableError(error), isError: true });
    }
  }, []);

  const signTyped = useCallback<TypedDataSigner>(
    (domain, types, message) => {
      if (connection === null) return Promise.reject(new Error("not connected"));
      return connection.signer.signTypedData(domain, types, message);
    },
    [connection],
  );

  const wrongChain = connection !== null && connection.chainId !== deployment.chainId;

  const observing = vantage === "observer";

  const { phase, progress } = useScenePhase(
    state.draw?.state ?? null,
    state.draw?.tierCursor ?? 0,
    state.draw?.indexCursor ?? 0,
    state.draw?.participantCount ?? state.participantCount,
    state.draw?.tierCount ?? 1,
  );

  /**
   * The next thing the draw needs, as one button.
   *
   * Four separate controls would have been a truer picture of the state
   * machine and a worse thing to hand someone: at any moment exactly one of
   * them does anything, and the other three are a quiz. The lifecycle is in
   * the stage row above; this is only ever the next step.
   */
  const drawStep = ((): DrawStep | null => {
    if (connection === null || contracts === null || observing || wrongChain) return null;

    const draw = state.draw;
    const acting = busy !== null;

    if (draw === null || draw.state === DrawState.Settled) {
      return {
        label: "Start a draw",
        busy: acting,
        // A draw with nothing in the reserve settles correctly and pays
        // nothing, which is the most confusing possible outcome for someone
        // pressing the button to see what a draw does. Better to say why.
        blockedBecause:
          state.unallocatedPrize === 0n
            ? "The prize reserve is empty, so a draw now would award nothing. The reserve is funded by the operator; the pool's own yield source is switched off on this deployment because it models returns rather than holding them."
            : undefined,
        run: () =>
          void run("seal", async () => {
            await (await contracts.engine["seal"]!()).wait();
            return "Sealed. The snapshot's weight has to be published next.";
          }),
      };
    }

    // Weight is published between sealing and opening, so a zero total on a
    // sealed draw is what tells the two apart.
    if (draw.state === DrawState.Sealed && draw.totalWeight === 0n) {
      return {
        label: "Publish the snapshot's weight",
        busy: acting,
        run: () =>
          void run("weight", async () => {
            const handle = (await contracts.ledger["sealedTotalWeight"]!(
              draw.drawId,
            )) as string;
            const { value, proof } = await decryptPublicWithProof(
              connection.injected,
              handle,
            );
            await (
              await contracts.engine["publishTotalWeight"]!(draw.drawId, value, proof)
            ).wait();
            return "Total weight published, and proved against the KMS.";
          }),
      };
    }

    if (draw.state === DrawState.Sealed) {
      return {
        label: "Open the draw",
        busy: acting,
        run: () =>
          void run("open", async () => {
            await (await contracts.engine["open"]!(draw.drawId)).wait();
            return "Open. The draw point was generated encrypted, and nobody can read it.";
          }),
      };
    }

    if (draw.state === DrawState.Selecting) {
      return {
        label: "Advance the walk",
        busy: acting,
        run: () =>
          void run("advance", async () => {
            await (await contracts.engine["advance"]!(draw.drawId, 10)).wait();
            return "Slice done. Every position in it was visited at identical cost.";
          }),
      };
    }

    return null;
  })();

  return (
    <main className={`shell${observing ? " observing" : ""}`}>
      <header className="masthead">
        <div>
          <h1 className="masthead-title">
            <Wordmark />
          </h1>
          <p className="masthead-subtitle">Confidential prize savings</p>
        </div>
        {connection === null ? (
          <Button
            variant="primary"
            onClick={() => void onConnect()}
            disabled={!walletDetected}
          >
            {walletDetected ? "Connect wallet" : "No wallet found"}
          </Button>
        ) : (
          <span className="address" style={{ fontSize: 13, color: "var(--ink-secondary)" }}>
            {shortAddress(connection.address)}
          </span>
        )}
      </header>

      {/*
        The scene sits above everything, before any number. Someone landing
        here should understand what the thing is before they are asked to read
        a balance — and the composition says it faster than the copy can.
      */}
      <UrnaScene
        participants={state.draw?.participantCount ?? state.participantCount}
        youIndex={state.balanceHandle !== null ? 0 : null}
        phase={phase}
        progress={progress}
      />

      {connection !== null && (
        <Group
          caption="Point of view"
          footnote={
            observing
              ? "This is the whole public record. Everything else on this page is encrypted on-chain — not merely hidden from the interface."
              : "Switch to see this page as any onlooker sees it. Nothing changes on-chain; only what the screen is allowed to render."
          }
        >
          <Row
            label={observing ? "Viewing as an onlooker" : "Viewing as yourself"}
            sublabel={
              observing
                ? "Aggregates only"
                : "Your own values, decrypted in this browser"
            }
            value={<VantageSwitch vantage={vantage} onChange={setVantage} />}
          />
        </Group>
      )}

      {!isDeployed && (
        <Group caption="Not configured">
          <Status tone="error">
            No deployment address is set. Run the deploy script, then fill in{" "}
            <span className="mono">frontend/lib/config.ts</span>.
          </Status>
        </Group>
      )}

      {wrongChain && (
        <Group caption="Network">
          <Row
            label="Wrong network"
            sublabel={`This deployment lives on ${deployment.chainName}.`}
            value={<Button onClick={() => void switchToDeploymentChain()}>Switch</Button>}
          />
        </Group>
      )}

      {notice !== null && (
        <Group>
          <Status tone={notice.isError ? "error" : "default"}>{notice.text}</Status>
        </Group>
      )}

      <PositionPanel
        connected={connection !== null}
        hasPosition={state.balanceHandle !== null}
        handle={state.balanceHandle}
        revealed={revealedBalance}
        busy={busy}
        vantage={vantage}
        onHide={() => setRevealedBalance(null)}
        onReveal={() =>
          void run("reveal", async () => {
            if (connection === null || state.balanceHandle === null) return;
            setRevealedBalance(
              await decryptOwn(
                connection.injected,
                state.balanceHandle,
                deployment.pool,
                connection.address,
                signTyped,
              ),
            );
          })
        }
      />

      {connection !== null && contracts !== null && !observing && (
        <FaucetPanel
          busy={busy}
          amount={FAUCET_AMOUNT}
          onMint={() =>
            void run("faucet", async () => {
              await (
                await contracts.token["mint"]!(connection.address, FAUCET_AMOUNT)
              ).wait();

              // Approving here rather than at deposit time means the reviewer
              // signs once and then deposits freely, instead of hitting an
              // operator prompt on their first attempt.
              const deadline = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
              await (
                await contracts.token["setOperator"]!(deployment.pool, deadline)
              ).wait();

              return "Test tokens minted, pool approved.";
            })
          }
        />
      )}

      {connection !== null && contracts !== null && !observing && (
        <MovePanel
          busy={busy}
          hasPosition={state.balanceHandle !== null}
          approved={state.poolApproved}
          onApprove={() =>
            void run("approve", async () => {
              // Chain time, not the browser's. A testnet clock can sit well
              // away from the machine's, and an approval dated in the chain's
              // past is refused when it is used rather than when it is set.
              const block = await connection.signer.provider!.getBlock("latest");
              const deadline = (block?.timestamp ?? 0) + 365 * 24 * 60 * 60;
              await (
                await contracts.token["setOperator"]!(deployment.pool, deadline)
              ).wait();
              return "Pool approved. It can move only what you tell it to.";
            })
          }
          onDeposit={(amount) =>
            void run("deposit", async () => {
              const { handle, proof } = await encryptAmount(
                connection.injected,
                deployment.pool,
                connection.address,
                amount,
              );
              await (await contracts.pool["deposit"]!(handle, proof)).wait();
              return "Deposit confirmed.";
            })
          }
          onWithdraw={(amount) =>
            void run("withdraw", async () => {
              const { handle, proof } = await encryptAmount(
                connection.injected,
                deployment.pool,
                connection.address,
                amount,
              );
              await (await contracts.pool["withdraw"]!(handle, proof)).wait();
              return "Withdrawal confirmed.";
            })
          }
        />
      )}

      <PoolPanel
        principal={state.publishedPrincipal}
        prize={state.unallocatedPrize}
        participants={state.participantCount}
        publishedAt={state.principalPublishedAt}
      />

      <DrawPanel draw={state.draw} step={drawStep ?? undefined} />

      <RulesPanel facts={deploymentFacts} />

      {state.awardHandle !== null && connection !== null && contracts !== null && state.draw !== null && (
        <AwardPanel
          drawId={state.draw.drawId}
          handle={state.awardHandle}
          isPublic={state.awardIsPublic}
          hasClaimed={state.hasClaimed}
          revealed={revealedAward}
          busy={busy}
          vantage={vantage}
          onReveal={() =>
            void run("reveal-award", async () => {
              const handle = state.awardHandle!;
              setRevealedAward(
                state.awardIsPublic
                  ? await decryptPublic(connection.injected, handle)
                  : await decryptOwn(
                      connection.injected,
                      handle,
                      deployment.vault,
                      connection.address,
                      signTyped,
                    ),
              );
            })
          }
          onClaim={() =>
            void run("claim", async () => {
              await (await contracts.vault["claim"]!(state.draw!.drawId)).wait();
              return "Award claimed.";
            })
          }
          onDisclose={() =>
            void run("disclose", async () => {
              await (await contracts.disclosure["disclose"]!(state.draw!.drawId)).wait();
              return "Award is now publicly verifiable.";
            })
          }
        />
      )}

      <footer style={{ marginTop: "var(--space-6)", fontSize: 12, color: "var(--ink-tertiary)" }}>
        Unaudited. Testnet only.
      </footer>
    </main>
  );
}
