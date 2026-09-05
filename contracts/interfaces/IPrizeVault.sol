// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/// @title Prize custody and settlement.
/// @notice Holds harvested yield, credits awards during a draw, and pays them
///         out when a winner claims.
interface IPrizeVault {
    event PrizeLocked(uint256 indexed drawId, uint64 amount);
    event PrizeFunded(uint64 amount, uint64 reserve);
    event AwardCredited(uint256 indexed drawId, address indexed account);
    event AwardClaimed(uint256 indexed drawId, address indexed account);

    /// @notice Fixes the prize a draw will pay and reserves it.
    /// @return prize The amount now committed to `drawId`.
    /// @dev Called once, as the draw opens. Reserving up front is what lets
    ///      the engine treat the prize as a public constant for the rest of
    ///      the walk while later harvests accumulate toward the next draw.
    function lockPrize(uint256 drawId) external returns (uint64 prize);

    /// @notice Adds an encrypted amount to an account's balance for a draw.
    /// @dev Called once per participant per tier. The amount is the tier prize
    ///      for the winner and zero for everyone else, and the vault cannot
    ///      tell which is which: both are ciphertexts produced by the same
    ///      `FHE.select`. Every participant is credited on every tier, so the
    ///      call pattern reveals nothing either.
    function credit(uint256 drawId, address account, euint64 amount) external;

    /// @notice Pays out the caller's award for a settled draw.
    /// @dev Transfers the encrypted amount to the caller. An account with no
    ///      winnings holds an encrypted zero, so claiming is indistinguishable
    ///      from not having won: a losing claim succeeds and moves nothing.
    function claim(uint256 drawId) external;

    /// @notice Handle to an account's award for a draw.
    function awardOf(uint256 drawId, address account) external view returns (euint64);

    /// @notice Whether an account has already claimed a draw's award.
    function hasClaimed(uint256 drawId, address account) external view returns (bool);
}
