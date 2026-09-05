// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IDisclosurePolicy} from "../interfaces/IDisclosurePolicy.sol";

/// @title Who may read a settled award.
///
/// @dev An award starts readable by exactly one account: the winner. Not the
///      pool operator, not the vault, not the protocol. Going further is the
///      winner's decision, made after they know what they won.
///
///      This is the property the Zama Protocol exists to make expressible.
///      Confidentiality is not all-or-nothing and it is not decided by
///      infrastructure; it is a rule written into the contract. A winner who
///      wants to prove a payout, for a leaderboard or an audit, can open their
///      own award without the pool ever being able to open it for them.
///
///      Disclosure is one-way. `FHE.makePubliclyDecryptable` cannot be undone:
///      once a value can be read, observers may already hold the plaintext, so
///      a "re-hide" would be a lie told by the contract. The registry refuses
///      a second disclosure rather than silently succeeding, which keeps the
///      event log an accurate record of who chose to go public and when.
contract DisclosureRegistry is IDisclosurePolicy, ZamaEthereumConfig, Ownable2Step {
    /// @notice The vault permitted to record awards.
    address public vault;

    mapping(uint256 drawId => mapping(address winner => euint64 amount)) private _award;
    mapping(uint256 drawId => mapping(address winner => Visibility)) private _visibility;

    error NotVault(address caller);
    error AlreadyWired();
    error NoAwardRecorded(uint256 drawId, address account);
    error AlreadyDisclosed(uint256 drawId, address account);

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault(msg.sender);
        _;
    }

    constructor(address owner_) Ownable(owner_) {}

    /// @notice Binds the vault allowed to record awards.
    function wire(address vault_) external onlyOwner {
        if (vault != address(0)) revert AlreadyWired();
        vault = vault_;
    }

    /// @inheritdoc IDisclosurePolicy
    function grantPrivate(uint256 drawId, address winner, euint64 amount) external onlyVault {
        FHE.allowThis(amount);
        FHE.allow(amount, winner);
        _award[drawId][winner] = amount;

        // An award that has already been disclosed stays disclosed. The public
        // grant applies to the earlier handle and cannot be taken back, so
        // resetting visibility here would put the registry's own view out of
        // step with the ACL's. Later credits within the same draw land in a
        // new handle that is private until its holder says otherwise.
        if (_visibility[drawId][winner] == Visibility.Public) {
            FHE.makePubliclyDecryptable(amount);
        }
    }

    /// @inheritdoc IDisclosurePolicy
    function disclose(uint256 drawId) external {
        euint64 amount = _award[drawId][msg.sender];
        if (!FHE.isInitialized(amount)) revert NoAwardRecorded(drawId, msg.sender);
        if (_visibility[drawId][msg.sender] == Visibility.Public) {
            revert AlreadyDisclosed(drawId, msg.sender);
        }

        _visibility[drawId][msg.sender] = Visibility.Public;
        FHE.makePubliclyDecryptable(amount);

        emit AwardDisclosed(drawId, msg.sender);
    }

    /// @inheritdoc IDisclosurePolicy
    function visibilityOf(uint256 drawId, address winner) external view returns (Visibility) {
        return _visibility[drawId][winner];
    }

    /// @notice Handle to a recorded award.
    /// @dev The handle is not a capability. Reading it requires an ACL entry,
    ///      which only the winner holds until they choose otherwise.
    function awardHandle(uint256 drawId, address winner) external view returns (euint64) {
        return _award[drawId][winner];
    }
}
