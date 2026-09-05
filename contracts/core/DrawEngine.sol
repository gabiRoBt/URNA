// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IDrawEngine} from "../interfaces/IDrawEngine.sol";
import {IEntropySource} from "../interfaces/IEntropySource.sol";
import {ITicketLedger} from "../interfaces/ITicketLedger.sol";
import {IPrizeVault} from "../interfaces/IPrizeVault.sol";

/// @title Weighted selection over encrypted balances, settled in batches.
///
/// @dev ## The walk
///
/// Selecting a winner in proportion to weight is an interval lookup: lay every
/// position end to end on a line of length `totalWeight`, pick a point `r` on
/// that line, and the interval containing `r` wins. On plaintext data you walk
/// until you pass `r` and stop.
///
/// Encrypted data forbids the stopping. The contract may not learn which entry
/// matched, so it cannot branch on the comparison and cannot exit early. Every
/// entry is visited, and an encrypted `found` flag suppresses matches after
/// the first:
///
///     prefix  = prefix + weight[i]
///     hit     = prefix > r              // r is public, so this is scalar
///     winner  = hit AND NOT found
///     found   = found OR hit
///     credit  = select(winner, prize, 0)
///
/// Cost is identical for every participant regardless of where the winner
/// sits, so the traversal itself leaks nothing.
///
/// ## Why it cannot finish in one transaction
///
/// The prefix chain is strictly sequential: entry `i` cannot be added before
/// entry `i-1`. fhEVM caps a transaction's *sequential depth* at 5,000,000
/// HCU, and each link costs 162,000, which puts the ceiling near 28 entries.
/// The global limit of 20,000,000 HCU is not what binds here.
///
/// So the walk checkpoints. Each `advance` restores `prefix` and `found` from
/// storage, consumes a bounded slice, and writes them back. This is a protocol
/// constraint rather than a tuning choice: an engine that tries to settle a
/// realistic pool atomically reverts on the coprocessors.
///
/// ## Why tiers are separate passes
///
/// Each prize tier re-walks the same snapshot with its own draw point. Running
/// them together would multiply the per-entry depth by the tier count and
/// shrink every batch proportionally. Kept separate, batch size is independent
/// of how many prizes a draw pays.
///
/// The same account can win more than one tier. Excluding prior winners would
/// require knowing who they are, which is precisely what the design refuses to
/// learn.
contract DrawEngine is IDrawEngine, ZamaEthereumConfig, Ownable2Step {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @dev Absolute ceiling, enforced regardless of configuration.
    ///
    ///      The HCU depth limit allows roughly 28 participants per transaction.
    ///      Gas binds sooner: a Sepolia deposit costs ~947k for its handful of
    ///      homomorphic operations, which puts a selection step near 400k, so a
    ///      slice of 28 would approach 12M gas. This cap keeps a slice from
    ///      ever being configured into territory where it cannot be mined.
    uint256 public constant SLICE_HARD_CAP = 28;

    /// @notice Largest slice `advance` will process in one transaction.
    ///
    /// @dev Configurable rather than constant because the two costs that bind
    ///      it — homomorphic depth and real gas — can only be measured against
    ///      a live deployment, and the answer differs between the mock
    ///      coprocessor and Sepolia. Being able to retune this without
    ///      redeploying is the difference between a calibration and a
    ///      migration.
    uint256 public maxSlice = 10;

    struct TierConfig {
        /// @dev Share of the draw's prize, in basis points.
        uint16 shareBps;
    }

    /// @dev Everything one slice of the walk needs, grouped so the loop keeps
    ///      its operands within the EVM's reachable stack depth. Passing these
    ///      individually exceeds it once the encrypted checkpoint is added.
    struct Slice {
        uint256 drawId;
        uint256 cursor;
        uint256 length;
        euint64 drawPoint;
        uint64 tierPrize;
    }

    /// @dev The encrypted state carried from one slice to the next.
    struct Checkpoint {
        euint64 prefix;
        ebool found;
    }

    /// @dev Encrypted checkpoint plus the public facts a draw is settled
    ///      against. Packed so a slice touches as few storage slots as
    ///      possible: the FHE work dominates, but the walk is long enough that
    ///      slot count still shows up in gas.
    struct Draw {
        DrawState state;
        uint8 tierCursor;
        uint32 participantCount;
        uint32 indexCursor;
        uint64 totalWeight;
        uint64 prize;
        euint64 prefix;
        ebool found;
        /// @dev The current tier's point on the weight line, encrypted. Drawn
        ///      once when the tier starts and reused across its slices, so a
        ///      tier settles against a single point rather than a new one per
        ///      transaction.
        euint64 drawPoint;
    }

    ITicketLedger public immutable ledger;
    IEntropySource public immutable entropy;
    IPrizeVault public immutable vault;

    TierConfig[] private _tiers;

    mapping(uint256 drawId => Draw draw) private _draws;

    uint256 private _currentDrawId;

    event TiersConfigured(uint16[] sharesBps);
    event MaxSliceUpdated(uint256 previous, uint256 current);

    error WrongState(uint256 drawId, DrawState expected, DrawState actual);
    error NoParticipants();
    error TotalWeightNotPublished(uint256 drawId);
    error TotalWeightAlreadyPublished(uint256 drawId);
    error EmptySnapshot(uint256 drawId);
    error TiersNotConfigured();
    error TierSharesExceedWhole(uint256 totalBps);
    error TooManyTiers(uint256 count);
    error SliceMustBePositive();
    error SliceOutOfRange(uint256 slice);

    constructor(
        address owner_,
        ITicketLedger ledger_,
        IEntropySource entropy_,
        IPrizeVault vault_
    ) Ownable(owner_) {
        ledger = ledger_;
        entropy = entropy_;
        vault = vault_;
    }

    /// @notice Sets how a draw's prize is split across tiers.
    /// @param sharesBps Share of each tier, in basis points, in payout order.
    /// @dev Shares may total less than 100%; the remainder stays in the vault
    ///      and rolls into the next draw. They may never total more, which
    ///      would promise prizes the vault cannot cover.
    function configureTiers(uint16[] calldata sharesBps) external onlyOwner {
        if (sharesBps.length == 0) revert TiersNotConfigured();
        if (sharesBps.length > type(uint8).max) revert TooManyTiers(sharesBps.length);

        uint256 totalBps;
        for (uint256 i = 0; i < sharesBps.length; ++i) {
            totalBps += sharesBps[i];
        }
        if (totalBps > BPS_DENOMINATOR) revert TierSharesExceedWhole(totalBps);

        delete _tiers;
        for (uint256 i = 0; i < sharesBps.length; ++i) {
            _tiers.push(TierConfig({shareBps: sharesBps[i]}));
        }

        emit TiersConfigured(sharesBps);
    }

    /// @notice Retunes how many positions one `advance` may process.
    /// @dev Takes effect immediately, including mid-draw: the walk is
    ///      checkpointed, so changing the step size between slices is safe and
    ///      does not affect the outcome. That is what makes it possible to
    ///      recover a draw that is stalling on gas without restarting it.
    function setMaxSlice(uint256 slice) external onlyOwner {
        if (slice == 0 || slice > SLICE_HARD_CAP) revert SliceOutOfRange(slice);
        emit MaxSliceUpdated(maxSlice, slice);
        maxSlice = slice;
    }

    /// @inheritdoc IDrawEngine
    function seal() external onlyOwner returns (uint256 drawId) {
        if (_tiers.length == 0) revert TiersNotConfigured();

        uint256 previous = _currentDrawId;
        if (previous != 0 && _draws[previous].state != DrawState.Settled) {
            revert WrongState(previous, DrawState.Settled, _draws[previous].state);
        }

        drawId = previous + 1;
        _currentDrawId = drawId;

        uint256 count = ledger.seal(drawId);
        if (count == 0) revert NoParticipants();
        if (count > type(uint32).max) revert TooManyTiers(count);

        Draw storage draw = _draws[drawId];
        draw.state = DrawState.Sealed;
        draw.participantCount = uint32(count);

        emit DrawSealed(drawId, count, 0);
    }

    /// @notice Publishes the snapshot's total weight, verified against the KMS.
    /// @param drawId The sealed draw.
    /// @param cleartextTotal The decrypted total weight.
    /// @param decryptionProof KMS signatures over that value.
    /// @dev Permissionless, and safe to be: the value is checked against the
    ///      KMS signatures for the exact handle the ledger froze, so a caller
    ///      can submit the true total or nothing at all. Leaving it open means
    ///      a draw cannot stall behind one privileged publisher.
    function publishTotalWeight(
        uint256 drawId,
        uint64 cleartextTotal,
        bytes calldata decryptionProof
    ) external {
        Draw storage draw = _draws[drawId];
        _requireState(drawId, draw.state, DrawState.Sealed);
        if (draw.totalWeight != 0) revert TotalWeightAlreadyPublished(drawId);

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint64.unwrap(ledger.sealedTotalWeight(drawId));

        FHE.checkSignatures(handles, abi.encode(cleartextTotal), decryptionProof);

        // A snapshot with no weight has no valid winner. Rather than paying an
        // arbitrary address, the draw settles empty and the prize rolls on.
        if (cleartextTotal == 0) revert EmptySnapshot(drawId);

        draw.totalWeight = cleartextTotal;
        emit DrawSealed(drawId, draw.participantCount, cleartextTotal);
    }

    /// @inheritdoc IDrawEngine
    function open(uint256 drawId) external {
        Draw storage draw = _draws[drawId];
        _requireState(drawId, draw.state, DrawState.Sealed);
        if (draw.totalWeight == 0) revert TotalWeightNotPublished(drawId);

        uint64 prize = vault.lockPrize(drawId);

        draw.prize = prize;
        draw.state = DrawState.Selecting;
        _beginTier(draw, drawId, 0);

        emit DrawSeeded(drawId, prize);
    }

    /// @inheritdoc IDrawEngine
    function advance(uint256 drawId, uint256 slice) external returns (bool done) {
        if (slice == 0) revert SliceMustBePositive();

        Draw storage draw = _draws[drawId];
        _requireState(drawId, draw.state, DrawState.Selecting);

        uint256 count = draw.participantCount;
        uint256 cursor = draw.indexCursor;
        uint8 tierIndex = draw.tierCursor;

        uint256 remaining = count - cursor;
        if (slice > remaining) slice = remaining;
        if (slice > maxSlice) slice = maxSlice;

        uint64 tierPrize = _tierPrize(draw.prize, _tiers[tierIndex].shareBps);

        Checkpoint memory checkpoint = _walk(
            Slice({
                drawId: drawId,
                cursor: cursor,
                length: slice,
                drawPoint: draw.drawPoint,
                tierPrize: tierPrize
            }),
            Checkpoint({prefix: draw.prefix, found: draw.found})
        );

        draw.prefix = checkpoint.prefix;
        draw.found = checkpoint.found;
        FHE.allowThis(checkpoint.prefix);
        FHE.allowThis(checkpoint.found);

        cursor += slice;
        emit DrawAdvanced(drawId, tierIndex, cursor, count);

        if (cursor < count) {
            draw.indexCursor = uint32(cursor);
            return false;
        }

        // Tier complete. The point it settled against stays encrypted, so the
        // event records that the tier closed and what it paid, not where the
        // draw landed.
        emit TierSettled(drawId, tierIndex, tierPrize);

        if (tierIndex + 1 < _tiers.length) {
            _beginTier(draw, drawId, tierIndex + 1);
            return false;
        }

        draw.indexCursor = uint32(cursor);
        draw.state = DrawState.Settled;
        ledger.release(drawId);

        emit DrawSettled(drawId, _totalAwarded(draw.prize));
        return true;
    }

    /// @dev Starts a tier: draws its point and resets the walk.
    ///
    ///      The point is drawn once here rather than per slice, so every slice
    ///      of a tier settles against the same point. Drawing per slice would
    ///      mean a position's odds depended on which transaction happened to
    ///      cover it, which is not a lottery.
    function _beginTier(Draw storage draw, uint256 drawId, uint8 tierIndex) private {
        draw.tierCursor = tierIndex;
        draw.indexCursor = 0;

        euint64 point = entropy.drawPoint(drawId, tierIndex, draw.totalWeight);
        FHE.allowThis(point);
        draw.drawPoint = point;

        draw.prefix = FHE.asEuint64(0);
        draw.found = FHE.asEbool(false);
        FHE.allowThis(draw.prefix);
        FHE.allowThis(draw.found);
    }

    /// @dev The selection loop itself, lifted out so `advance` stays readable
    ///      and so the stack stays inside its limit while carrying both the
    ///      encrypted checkpoint and the public draw parameters.
    function _walk(Slice memory slice, Checkpoint memory checkpoint)
        private
        returns (Checkpoint memory)
    {
        // Encrypted once per slice rather than once per entry. Trivial
        // encryption is nearly free, but the handle is reused across the whole
        // loop, so there is no reason to re-derive it.
        euint64 prizeCiphertext = FHE.asEuint64(slice.tierPrize);
        euint64 zero = FHE.asEuint64(0);

        for (uint256 offset = 0; offset < slice.length; ++offset) {
            (address account, euint64 weight) = ledger.weightAt(
                slice.drawId,
                slice.cursor + offset
            );

            checkpoint.prefix = FHE.add(checkpoint.prefix, weight);

            // Strictly greater. With weights [10,20,30] and r=10 the winner is
            // the second position, which owns [10,30); using >= would hand it
            // to the first and bias every boundary toward earlier entries.
            ebool hit = FHE.gt(checkpoint.prefix, slice.drawPoint);
            ebool isWinner = FHE.and(hit, FHE.not(checkpoint.found));
            checkpoint.found = FHE.or(checkpoint.found, hit);

            euint64 credit = FHE.select(isWinner, prizeCiphertext, zero);
            FHE.allowTransient(credit, address(vault));
            vault.credit(slice.drawId, account, credit);
        }

        return checkpoint;
    }

    function _tierPrize(uint64 prize, uint16 shareBps) private pure returns (uint64) {
        return uint64((uint256(prize) * shareBps) / BPS_DENOMINATOR);
    }

    function _totalAwarded(uint64 prize) private view returns (uint256 awarded) {
        for (uint256 i = 0; i < _tiers.length; ++i) {
            awarded += _tierPrize(prize, _tiers[i].shareBps);
        }
    }

    function _requireState(uint256 drawId, DrawState actual, DrawState expected) private pure {
        if (actual != expected) revert WrongState(drawId, expected, actual);
    }

    /// @inheritdoc IDrawEngine
    function stateOf(uint256 drawId) external view returns (DrawState) {
        return _draws[drawId].state;
    }

    /// @inheritdoc IDrawEngine
    function currentDrawId() external view returns (uint256) {
        return _currentDrawId;
    }

    /// @notice The public facts about a draw.
    ///
    /// @dev What is here is what a draw legitimately publishes: how many
    ///      positions it covered, how much weight they carried in total, what
    ///      it paid, and how far the walk has run.
    ///
    ///      What is deliberately absent is the point each tier settled
    ///      against. It is generated encrypted and never decrypted, so it
    ///      cannot appear here — and that is the stronger property. A
    ///      published point plus a published total would let an observer
    ///      narrow down the winner as soon as any position's weight leaked
    ///      through some other channel.
    function drawFacts(uint256 drawId)
        external
        view
        returns (
            DrawState state,
            uint64 totalWeight,
            uint64 prize,
            uint32 participantCount,
            uint8 tierCursor,
            uint32 indexCursor,
            uint256 tierTotal
        )
    {
        Draw storage draw = _draws[drawId];
        return (
            draw.state,
            draw.totalWeight,
            draw.prize,
            draw.participantCount,
            draw.tierCursor,
            draw.indexCursor,
            _tiers.length
        );
    }

    /// @notice Handle to the point the current tier is settling against.
    /// @dev The handle is not the value. No ACL entry is ever issued for it,
    ///      by this contract or the entropy source, so it cannot be decrypted
    ///      by anyone. Exposed only so a reader can confirm a point exists and
    ///      changes from tier to tier.
    function drawPointHandle(uint256 drawId) external view returns (euint64) {
        return _draws[drawId].drawPoint;
    }

    /// @notice Number of configured prize tiers.
    function tierCount() external view returns (uint256) {
        return _tiers.length;
    }

    /// @notice Share of the prize paid by a tier, in basis points.
    function tierShareBps(uint8 tierIndex) external view returns (uint16) {
        return _tiers[tierIndex].shareBps;
    }
}
