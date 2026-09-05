// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

/// @title Yield generation.
/// @notice Abstracts where a draw's prize comes from.
/// @dev Prize amounts are public. That is a deliberate consequence of making
///      the draw verifiable: an observer needs the tier prize to recompute the
///      draw point, and the yield a pool earns is an aggregate that reveals
///      nothing about any individual position.
///
///      Deposits flow in as plaintext totals because the pool's aggregate TVL
///      is already observable from the yield venue's side. What stays
///      confidential is the split of that total across participants.
interface IYieldSource {
    /// @notice Emitted when principal is committed to the yield venue.
    event PrincipalDeposited(uint256 amount, uint256 totalPrincipal);

    /// @notice Emitted when principal is reclaimed for a withdrawal.
    event PrincipalWithdrawn(uint256 amount, uint256 totalPrincipal);

    /// @notice Emitted when accrued yield is harvested into a prize.
    event YieldHarvested(uint256 amount, uint256 harvestedAt);

    /// @notice Commits principal to the yield venue.
    /// @dev Called by the pool after a deposit settles. The pool is the only
    ///      authorised caller.
    function depositPrincipal(uint256 amount) external;

    /// @notice Reclaims principal so the pool can honour a withdrawal.
    /// @dev Must always succeed for any amount up to `totalPrincipal`.
    ///      A yield source that can refuse to return principal breaks the
    ///      pool's central promise that deposits are withdrawable at any time.
    function withdrawPrincipal(uint256 amount) external;

    /// @notice Harvests accrued yield and hands it to the caller as prize.
    /// @return harvested The amount realised, which becomes the draw's prize.
    /// @dev Harvesting must never touch principal. A source that returns more
    ///      than it earned is paying prizes out of deposits.
    function harvest() external returns (uint256 harvested);

    /// @notice Yield accrued but not yet harvested.
    function pendingYield() external view returns (uint256);

    /// @notice Principal currently committed to the venue.
    function totalPrincipal() external view returns (uint256);
}
