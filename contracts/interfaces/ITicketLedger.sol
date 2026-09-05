// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/// @title The register of draw weights.
/// @notice Tracks who is in the pool and how much weight each position carries,
///         and freezes that view for the duration of a draw.
interface ITicketLedger {
    event ParticipantJoined(address indexed account, uint256 index);
    event WeightSynced(address indexed account);
    event LedgerSealed(uint256 indexed drawId, uint256 participantCount);
    event LedgerReleased(uint256 indexed drawId);

    /// @notice Recomputes an account's draw weight from its new balance.
    /// @dev Called by the pool whenever a balance moves. Weight is derived
    ///      eagerly, at the moment of the deposit or withdrawal, rather than
    ///      when a draw is sealed. That places the homomorphic cost on the
    ///      account causing it and keeps sealing a constant-time operation.
    function sync(address account, euint64 balance) external;

    /// @notice Freezes the current participant set for a draw.
    /// @return participantCount Number of positions this draw will walk.
    function seal(uint256 drawId) external returns (uint256 participantCount);

    /// @notice Lifts the freeze once a draw has settled.
    function release(uint256 drawId) external;

    /// @notice The weight a position carried when `drawId` was sealed.
    /// @dev Returns the frozen value for accounts that have moved since the
    ///      seal, and the live value for those that have not.
    function weightAt(uint256 drawId, uint256 index)
        external
        view
        returns (address account, euint64 weight);

    /// @notice Number of positions frozen into `drawId`.
    function sealedCount(uint256 drawId) external view returns (uint256);

    /// @notice Handle to the total weight frozen into `drawId`.
    /// @dev Made publicly decryptable when the draw is sealed.
    function sealedTotalWeight(uint256 drawId) external view returns (euint64);

    /// @notice Current number of known positions.
    function participantCount() external view returns (uint256);

    /// @notice Position at `index` in traversal order.
    function participantAt(uint256 index) external view returns (address);
}
