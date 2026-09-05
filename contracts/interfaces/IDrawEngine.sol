// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

/// @title Draw lifecycle.
/// @notice Orchestrates a draw from sealed snapshot to settled awards.
///
/// @dev ## Why a draw is batched rather than atomic
///
/// Selecting a winner over encrypted weights is a prefix-sum walk: each
/// participant's running total depends on the previous one. That chain is the
/// transaction's sequential-depth cost, and fhEVM caps depth at 5,000,000 HCU
/// per transaction. At 162,000 HCU per link, a single transaction can advance
/// the walk by roughly 28 participants before the coprocessors refuse it.
///
/// A pool of any realistic size therefore cannot settle in one call. The walk
/// is instead checkpointed: each `advance` consumes a bounded slice of the
/// snapshot, persists the encrypted running state, and returns. The draw
/// completes when every tier has walked every participant.
///
/// This is a hard protocol constraint, not an optimisation. An implementation
/// that tries to settle atomically works in tests against a handful of
/// accounts and reverts in production.
interface IDrawEngine {
    /// @notice Where a draw sits in its lifecycle.
    /// @dev Transitions are strictly forward. There is no path back to `Open`
    ///      from a sealed snapshot except by completing the draw, so a draw
    ///      can never reopen to admit deposits that would change its outcome.
    enum DrawState {
        /// @dev No draw in progress. Deposits and withdrawals flow freely.
        Open,
        /// @dev Snapshot sealed and weights frozen, total weight not yet published.
        Sealed,
        /// @dev Prize fixed and the selection walk is in progress.
        Selecting,
        /// @dev Every tier settled. Awards are claimable.
        Settled
    }

    event DrawSealed(uint256 indexed drawId, uint256 participantCount, uint256 totalWeight);
    event DrawSeeded(uint256 indexed drawId, uint256 prize);
    event DrawAdvanced(uint256 indexed drawId, uint8 tierIndex, uint256 cursor, uint256 participantCount);

    /// @dev Records that a tier closed and what it paid. Not where the draw
    ///      landed: that point is encrypted and never leaves the coprocessors,
    ///      so publishing it here is not possible even in principle.
    event TierSettled(uint256 indexed drawId, uint8 tierIndex, uint256 amount);

    event DrawSettled(uint256 indexed drawId, uint256 totalAwarded);

    /// @notice Seals the current snapshot and freezes draw weights.
    /// @return drawId The draw now sealed.
    /// @dev After this call the participant set and every weight are fixed.
    ///      Deposits and withdrawals continue to work against live balances,
    ///      but they no longer affect this draw.
    function seal() external returns (uint256 drawId);

    /// @notice Reveals the seed and fixes the prize, opening the walk.
    /// @dev Separate from `seal` on purpose. The seed must not be knowable
    ///      while the snapshot is still forming, so revealing it is a distinct
    ///      step that happens strictly after the participant set is frozen.
    function open(uint256 drawId) external;

    /// @notice Advances the selection walk by up to `slice` participants.
    /// @param drawId The draw to advance.
    /// @param slice Maximum participants to process in this call.
    /// @return done Whether the draw is now fully settled.
    /// @dev Permissionless. Anyone may advance a draw: the work is
    ///      deterministic and the outcome is already fixed by the sealed
    ///      snapshot and the revealed seed, so there is nothing for a caller
    ///      to influence. Making it permissionless means a draw cannot stall
    ///      because one privileged keeper went offline.
    ///
    ///      `slice` is clamped to the engine's configured batch ceiling.
    function advance(uint256 drawId, uint256 slice) external returns (bool done);

    /// @notice Current lifecycle state of a draw.
    function stateOf(uint256 drawId) external view returns (DrawState);

    /// @notice The draw currently accepting `seal`, `open`, or `advance`.
    function currentDrawId() external view returns (uint256);
}
