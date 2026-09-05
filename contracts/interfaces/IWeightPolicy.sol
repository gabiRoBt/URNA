// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/// @title Draw weight derivation.
/// @notice Turns a confidential balance into the weight that decides a
///         position's odds in a draw.
/// @dev This is the seam that lets odds be computed differently without the
///      draw engine knowing anything about it. Implementations must be pure
///      with respect to protocol state: the same balance must always produce
///      the same weight within a snapshot, or the prefix sums the engine
///      builds across several transactions will not agree with each other.
interface IWeightPolicy {
    /// @notice Derives draw weight from a confidential balance.
    /// @param balance The position's principal, encrypted.
    /// @return weight The position's draw weight, encrypted.
    /// @dev The returned handle must be readable by the caller. Implementations
    ///      are responsible for calling `FHE.allowTransient` on the result so
    ///      the engine can consume it within the same transaction.
    function weigh(euint64 balance) external returns (euint64 weight);

    /// @notice Human-readable identifier, surfaced in draw metadata so an
    ///         observer can tell which rule produced a given snapshot.
    function policyName() external view returns (string memory);
}
