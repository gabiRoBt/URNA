// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {IEntropySource} from "../interfaces/IEntropySource.sol";

/// @title Draw randomness from the protocol's own generator.
///
/// @dev ## Why this and not commit-reveal
///
/// A commit-reveal scheme needs a secret, and a secret has to be generated
/// somewhere off-chain. Whoever holds it knows the outcome before anyone else
/// does, and can decline to reveal a result they dislike — the honest version
/// of that scheme still leaves the operator able to stall a draw they would
/// rather not settle.
///
/// `FHE.randEuint64` has no such holder. The value is produced on-chain by the
/// coprocessors, deterministically across them, and it is encrypted from the
/// moment it exists. There is no seed anyone could have known in advance, no
/// reveal step to withhold, and no plaintext to grind against.
///
/// ## What this leaks
///
/// Nothing about the point itself. It is generated encrypted, reduced
/// encrypted, and compared encrypted; no step of a draw ever holds it in
/// plaintext, and the only public input is the total weight the line is drawn
/// across.
///
/// ## The one imperfection, stated plainly
///
/// Reducing a uniform 64-bit value modulo `totalWeight` is very slightly
/// biased toward low residues, because 2^64 is not a multiple of the total.
/// The bias is bounded by `totalWeight / 2^64`. For a pool holding a trillion
/// base units that is about one part in ten million — far below the noise of
/// any real draw, and far below the precision anyone could measure it at.
///
/// Removing it entirely would need rejection sampling: draw, compare against a
/// cutoff, redraw on failure. Encrypted execution cannot branch on that
/// comparison, so the loop would have to run a fixed number of times and
/// select among the results, paying full cost for every unused draw. That is a
/// large, permanent cost against a bias nobody can detect, so the bias stays
/// and is documented instead.
contract FheRandomEntropy is IEntropySource, ZamaEthereumConfig {
    error EmptyWeightLine();

    /// @inheritdoc IEntropySource
    function drawPoint(uint256 drawId, uint8 tierIndex, uint64 totalWeight)
        external
        returns (euint64 point)
    {
        if (totalWeight == 0) revert EmptyWeightLine();

        // A fresh value per call. The generator advances its own state on
        // chain, so two tiers of the same draw cannot collide even though
        // nothing distinguishes their calls.
        euint64 raw = FHE.randEuint64();

        // Scalar remainder: the divisor is the public total, so this is the
        // cheap form of the operation rather than a ciphertext division.
        point = FHE.rem(raw, totalWeight);

        FHE.allowThis(point);
        FHE.allowTransient(point, msg.sender);

        // Emitted for traceability. The handle is not the value: without an
        // ACL entry it cannot be decrypted, and none is ever granted.
        emit PointDrawn(drawId, tierIndex, euint64.unwrap(point));
    }

    /// @notice Records that a point was drawn, without revealing it.
    event PointDrawn(uint256 indexed drawId, uint8 indexed tierIndex, bytes32 handle);
}
