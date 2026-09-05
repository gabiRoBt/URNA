// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {IWeightPolicy} from "../interfaces/IWeightPolicy.sol";

/// @title One unit deposited is one ticket.
/// @notice The baseline rule: draw weight equals confidential balance.
/// @dev Costs nothing at snapshot time. The balance handle is passed straight
///      through, so no homomorphic work is charged and the snapshot batch is
///      bounded only by storage gas.
///
///      This is also the protocol's fallback. If the tiered policy ever needs
///      to be withdrawn, swapping to this one changes odds and cost but no
///      other behaviour, because the engine consumes weights without knowing
///      how they were derived.
contract LinearWeightPolicy is IWeightPolicy, ZamaEthereumConfig {
    /// @inheritdoc IWeightPolicy
    function weigh(euint64 balance) external returns (euint64 weight) {
        // Re-granting transient access is what makes the pass-through safe:
        // the caller receives a handle it is allowed to read for the rest of
        // this transaction, exactly as it would for a freshly computed value.
        FHE.allowTransient(balance, msg.sender);
        return balance;
    }

    /// @inheritdoc IWeightPolicy
    function policyName() external pure returns (string memory) {
        return "linear";
    }
}
