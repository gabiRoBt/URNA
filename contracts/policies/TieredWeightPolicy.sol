// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IWeightPolicy} from "../interfaces/IWeightPolicy.sol";

/// @title Draw weight with a confidential tier bonus.
/// @notice Positions at or above a hidden threshold receive better odds, and
///         nobody can tell which positions those are.
///
/// @dev ## What stays hidden
///
/// Two things, and the second is the interesting one:
///
/// 1. The threshold. Stored as `euint64`, never decrypted by this contract.
///    An observer cannot locate the tier boundary.
/// 2. Membership. Because the boundary check is `FHE.select` rather than a
///    Solidity `if`, the contract itself never learns whether a given position
///    qualified. Both branches are always evaluated; only the encrypted
///    control decides which result survives. Gas and HCU are identical either
///    way, so even a timing or cost observer learns nothing.
///
/// The resulting weight is a single ciphertext that could have come from
/// either branch. A participant who knows their own balance still cannot tell
/// whether they cleared the bar, because they cannot read the threshold.
///
/// ## Why a shift rather than a multiplier
///
/// The bonus is `balance >> bonusShift`, giving 1.5x at shift 1, 1.25x at
/// shift 2, and so on. A percentage multiplier would need `FHE.mul`, which
/// costs 365,000 HCU against a scalar shift's 34,000. That difference is
/// charged once per participant per snapshot, so at the pool's batch size it
/// is the difference between a comfortable batch and a reverting one.
contract TieredWeightPolicy is IWeightPolicy, ZamaEthereumConfig, Ownable2Step {
    /// @dev Shifting by 64 or more is undefined for a uint64 and would silently
    ///      produce a zero bonus, turning a misconfiguration into a policy that
    ///      quietly does nothing.
    uint8 private constant MAX_SHIFT = 63;

    /// @notice Encrypted balance at or above which the bonus applies.
    euint64 private _threshold;

    /// @notice How far the balance is shifted right to form the bonus.
    uint8 public bonusShift;

    event ThresholdUpdated(address indexed by);
    event BonusShiftUpdated(uint8 previousShift, uint8 newShift);

    error ShiftOutOfRange(uint8 shift);
    error ThresholdNotSet();

    /// @param owner_ Account permitted to retune the tier.
    /// @param bonusShift_ Right-shift applied to the balance to form the bonus.
    constructor(address owner_, uint8 bonusShift_) Ownable(owner_) {
        if (bonusShift_ > MAX_SHIFT) revert ShiftOutOfRange(bonusShift_);
        bonusShift = bonusShift_;
    }

    /// @notice Sets the confidential threshold from a client-side ciphertext.
    /// @param encryptedThreshold Threshold, encrypted by the caller.
    /// @param inputProof Proof that the ciphertext was formed correctly.
    /// @dev The owner supplies the threshold already encrypted, so it is never
    ///      visible in calldata. Even the owner's own transaction does not
    ///      reveal it to anyone reading the chain.
    function setThreshold(externalEuint64 encryptedThreshold, bytes calldata inputProof)
        external
        onlyOwner
    {
        euint64 threshold = FHE.fromExternal(encryptedThreshold, inputProof);

        // The policy must be able to reuse this handle in every future
        // snapshot, across transactions it does not initiate.
        FHE.allowThis(threshold);
        _threshold = threshold;

        emit ThresholdUpdated(msg.sender);
    }

    /// @notice Retunes how large the bonus is.
    /// @dev Takes effect from the next snapshot. Changing it mid-draw would
    ///      make a sealed snapshot's weights disagree with each other across
    ///      batches, so the engine reads weights only while sealing.
    function setBonusShift(uint8 newShift) external onlyOwner {
        if (newShift > MAX_SHIFT) revert ShiftOutOfRange(newShift);
        emit BonusShiftUpdated(bonusShift, newShift);
        bonusShift = newShift;
    }

    /// @inheritdoc IWeightPolicy
    function weigh(euint64 balance) external returns (euint64 weight) {
        if (!FHE.isInitialized(_threshold)) revert ThresholdNotSet();

        ebool qualifies = FHE.ge(balance, _threshold);
        euint64 bonus = FHE.select(qualifies, FHE.shr(balance, bonusShift), FHE.asEuint64(0));
        weight = FHE.add(balance, bonus);

        // Both handles need to outlive this call: the caller consumes the
        // weight now, and the engine re-reads it from the ledger in later
        // batches of the same draw.
        FHE.allowThis(weight);
        FHE.allowTransient(weight, msg.sender);
    }

    /// @notice Handle to the encrypted threshold.
    /// @dev Returning the handle is safe: without an ACL grant it cannot be
    ///      decrypted. Exposed so the owner can verify what they configured.
    function thresholdHandle() external view returns (euint64) {
        return _threshold;
    }

    /// @inheritdoc IWeightPolicy
    function policyName() external pure returns (string memory) {
        return "tiered";
    }
}
