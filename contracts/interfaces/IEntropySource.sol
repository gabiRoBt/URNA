// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/// @title Draw randomness.
/// @notice Produces the point on the weight line that decides one tier.
///
/// @dev The point is returned encrypted, and stays that way. Nobody — not the
///      operator, not a participant, not an observer — ever learns where on
///      the line the draw landed, which means nobody can work out who won by
///      combining that point with anything else they know.
///
///      Returning the point rather than a raw seed is deliberate: mapping a
///      seed into `[0, totalWeight)` is the step where bias creeps in, and
///      keeping it inside the entropy source means every implementation is
///      answerable for it instead of leaving it to each caller.
interface IEntropySource {
    /// @notice Draws a point in `[0, totalWeight)` for one tier of one draw.
    /// @param drawId The draw being settled.
    /// @param tierIndex Which prize tier this point decides.
    /// @param totalWeight Size of the weight line, public.
    /// @return point The encrypted draw point.
    /// @dev Must grant the caller transient access to the returned handle.
    ///      Implementations must produce a fresh, independent point per call:
    ///      reusing one across tiers would hand every prize to one position.
    function drawPoint(uint256 drawId, uint8 tierIndex, uint64 totalWeight)
        external
        returns (euint64 point);
}
