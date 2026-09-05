// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/// @title Selective disclosure.
/// @notice Governs who may decrypt a settled award.
///
/// @dev Awards are held per draw, not per tier. An account that wins several
///      tiers of one draw holds a single encrypted total, because the vault
///      credits every participant on every tier and cannot tell the winning
///      credits from the zero ones. Splitting disclosure by tier would require
///      knowing which tier paid, which is exactly what the design refuses to
///      learn.
///
///      The default is the strict one: an award is readable by its winner and
///      by nobody else, including the protocol. Everything beyond that is the
///      winner's own decision, taken after the fact.
///
///      This is the mechanism the Zama Protocol exists to make expressible —
///      decryption rights defined in the contract rather than assumed by the
///      infrastructure — so the pool models it explicitly rather than folding
///      it into the vault as an implementation detail.
interface IDisclosurePolicy {
    /// @notice How widely an award may be read.
    enum Visibility {
        /// @dev Winner only. The state every award starts in.
        Private,
        /// @dev Anyone may decrypt. Set only by the winner, only for their own
        ///      award, and never reversible: a value that has been publicly
        ///      decryptable cannot be made secret again, because observers may
        ///      already hold the plaintext.
        Public
    }

    event AwardDisclosed(uint256 indexed drawId, address indexed winner);

    /// @notice Grants the winner exclusive decryption rights over an award.
    /// @dev Called by the vault as an award is credited.
    function grantPrivate(uint256 drawId, address winner, euint64 amount) external;

    /// @notice Makes the caller's own award publicly decryptable.
    /// @dev Callable only by the account holding that award. Irreversible by
    ///      construction; implementations must reject a second disclosure
    ///      rather than silently succeeding, so the event log stays a faithful
    ///      record of who chose to go public and when.
    function disclose(uint256 drawId) external;

    /// @notice Current visibility of an award.
    function visibilityOf(uint256 drawId, address winner) external view returns (Visibility);
}
