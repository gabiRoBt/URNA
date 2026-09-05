// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {IEntropySource} from "../interfaces/IEntropySource.sol";

/// @title An entropy source that returns a point you choose. Tests only.
///
/// @dev Real randomness makes the draw unpredictable, which is the point in
///      production and a problem in a test: with `FheRandomEntropy` there is
///      no way to assert that the contract picked the *right* winner, only
///      that it picked exactly one.
///
///      Substituting this makes the walk deterministic, so a test can compute
///      the expected winner from the reference model and compare. That the
///      substitution is possible at all is the argument for entropy being an
///      interface rather than a call to `FHE.randEuint64` inlined in the
///      engine.
///
///      Never deploy this. A draw settled against a point the operator chose
///      is not a draw.
contract FixedPointEntropy is IEntropySource, ZamaEthereumConfig {
    /// @dev Point returned for each tier, in plaintext. Set by the test.
    mapping(uint8 tierIndex => uint64 point) public points;

    function setPoint(uint8 tierIndex, uint64 point) external {
        points[tierIndex] = point;
    }

    /// @inheritdoc IEntropySource
    function drawPoint(uint256 drawId, uint8 tierIndex, uint64 totalWeight)
        external
        returns (euint64 point)
    {
        // Wrap rather than reject an out-of-range point, so a test can set one
        // value and reuse it across snapshots of different sizes.
        uint64 chosen = points[tierIndex] % totalWeight;

        point = FHE.asEuint64(chosen);
        FHE.allowThis(point);
        FHE.allowTransient(point, msg.sender);

        drawId;
    }
}
