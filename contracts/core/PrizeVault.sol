// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {IPrizeVault} from "../interfaces/IPrizeVault.sol";
import {IYieldSource} from "../interfaces/IYieldSource.sol";
import {IDisclosurePolicy} from "../interfaces/IDisclosurePolicy.sol";

/// @title Custody and settlement of draw prizes.
///
/// @dev ## Why every participant is credited
///
/// The engine credits an amount for each participant on each tier: the tier
/// prize for the winner, an encrypted zero for everyone else. It cannot tell
/// them apart, and neither can this vault, because both are ciphertexts
/// produced by the same `FHE.select`.
///
/// That uniformity is the point. If the vault were credited only for winners,
/// the call pattern alone would identify them, and every homomorphic operation
/// upstream would have been wasted. The same reasoning makes claiming safe: an
/// account that won nothing holds an encrypted zero, so a losing claim
/// succeeds and transfers nothing, and observers cannot separate it from a
/// winning one.
///
/// ## Solvency
///
/// A draw's prize is reserved in full when it opens, before any award is
/// credited. Later harvests accrue toward the next draw rather than the one in
/// flight, so the amount the engine treats as a public constant during the
/// walk is backed for the walk's whole duration.
contract PrizeVault is IPrizeVault, ZamaEthereumConfig, Ownable2Step {
    /// @notice The confidential token prizes are held and paid in.
    IERC7984 public immutable asset;

    /// @notice The engine permitted to lock prizes and credit awards.
    address public engine;

    /// @notice Where harvested yield comes from.
    IYieldSource public immutable yieldSource;

    /// @notice Rule governing who may decrypt a settled award.
    IDisclosurePolicy public immutable disclosure;

    /// @notice Yield harvested but not yet committed to a draw.
    uint64 public unallocatedPrize;

    mapping(uint256 drawId => uint64 prize) private _lockedPrize;
    mapping(uint256 drawId => mapping(address account => euint64 award)) private _awards;
    mapping(uint256 drawId => mapping(address account => bool claimed)) private _claimed;

    error NotEngine(address caller);
    error AlreadyWired();
    error PrizeAlreadyLocked(uint256 drawId);
    error AlreadyClaimed(uint256 drawId, address account);
    error NothingToClaim(uint256 drawId, address account);

    modifier onlyEngine() {
        if (msg.sender != engine) revert NotEngine(msg.sender);
        _;
    }

    constructor(
        address owner_,
        IERC7984 asset_,
        IYieldSource yieldSource_,
        IDisclosurePolicy disclosure_
    ) Ownable(owner_) {
        asset = asset_;
        yieldSource = yieldSource_;
        disclosure = disclosure_;
    }

    /// @notice Binds the engine allowed to settle draws against this vault.
    /// @dev One-time, for the same reason the ledger's wiring is: the engine
    ///      needs the vault's address at construction, so the reference can
    ///      only be closed afterwards.
    function wire(address engine_) external onlyOwner {
        if (engine != address(0)) revert AlreadyWired();
        engine = engine_;
    }

    /// @notice Harvests yield into the pool of prize money.
    /// @dev Permissionless. Harvesting moves value from the yield venue into
    ///      the vault and can only increase what participants collectively
    ///      own, so there is nothing to gate.
    function harvest() external returns (uint64 harvested) {
        uint256 amount = yieldSource.harvest();
        harvested = uint64(amount);
        unallocatedPrize += harvested;
    }

    /// @notice Adds to the prize reserve directly.
    ///
    /// @dev Yield accrues against wall-clock time, which makes a live
    ///      demonstration awkward: a pool earning a few percent a year has
    ///      produced nothing worth drawing for by the time anyone is watching.
    ///      This lets the operator seed a prize so a draw can be shown
    ///      end to end.
    ///
    ///      It is an operator-funded reserve, not a yield mechanism, and it is
    ///      the one privileged money movement in the protocol. Note the
    ///      direction: it can only add. There is no path here that takes value
    ///      out of the vault, so an operator can subsidise a draw and can
    ///      never drain one.
    ///      The tokens move here, they are not merely counted. The operator
    ///      must have made this vault an operator on the asset first, exactly
    ///      as a depositor does for the pool.
    function fundPrize(uint64 amount) external onlyOwner {
        euint64 encrypted = FHE.asEuint64(amount);
        FHE.allowThis(encrypted);
        FHE.allowTransient(encrypted, address(asset));

        // ERC7984 clamps a transfer to what the sender actually holds instead
        // of reverting, because reverting would reveal the balance. So what
        // arrives is what moved, not what was asked for — and it arrives as a
        // ciphertext, while the reserve is a public figure. Funding what you
        // do not hold therefore overstates the reserve rather than failing
        // loudly. It can never reach principal: the vault pays out of its own
        // balance, and the pool's deposits are held somewhere else entirely.
        asset.confidentialTransferFrom(msg.sender, address(this), encrypted);

        unallocatedPrize += amount;
        emit PrizeFunded(amount, unallocatedPrize);
    }

    /// @inheritdoc IPrizeVault
    function lockPrize(uint256 drawId) external onlyEngine returns (uint64 prize) {
        if (_lockedPrize[drawId] != 0) revert PrizeAlreadyLocked(drawId);

        prize = unallocatedPrize;
        unallocatedPrize = 0;
        _lockedPrize[drawId] = prize;

        emit PrizeLocked(drawId, prize);
    }

    /// @inheritdoc IPrizeVault
    function credit(uint256 drawId, address account, euint64 amount) external onlyEngine {
        euint64 current = _awards[drawId][account];
        euint64 updated = FHE.isInitialized(current) ? FHE.add(current, amount) : amount;

        FHE.allowThis(updated);
        _awards[drawId][account] = updated;

        // The registry issues the winner's read grant, so it needs access to
        // the handle for the duration of that call.
        FHE.allowTransient(updated, address(disclosure));

        // The winner is granted read access to their own award as it is
        // credited, not when they claim. Anything later would mean the vault
        // holds a value nobody can read, and a claim that reverts for the one
        // account entitled to it.
        disclosure.grantPrivate(drawId, account, updated);

        emit AwardCredited(drawId, account);
    }

    /// @inheritdoc IPrizeVault
    function claim(uint256 drawId) external {
        if (_claimed[drawId][msg.sender]) revert AlreadyClaimed(drawId, msg.sender);

        euint64 award = _awards[drawId][msg.sender];
        if (!FHE.isInitialized(award)) revert NothingToClaim(drawId, msg.sender);

        _claimed[drawId][msg.sender] = true;

        // Re-granting on claim keeps the award readable to its winner after
        // settlement, which is what makes a claim receipt meaningful.
        FHE.allow(award, msg.sender);

        // And the money moves. Every participant of a draw holds an award —
        // the tier prize for the winner, an encrypted zero for everyone else —
        // so a loser's claim succeeds and transfers nothing. From outside, the
        // two are one transaction of the same shape against the same token,
        // which is what keeps the payout as private as the draw that produced
        // it.
        FHE.allowTransient(award, address(asset));
        asset.confidentialTransfer(msg.sender, award);

        emit AwardClaimed(drawId, msg.sender);
    }

    /// @inheritdoc IPrizeVault
    function awardOf(uint256 drawId, address account) external view returns (euint64) {
        return _awards[drawId][account];
    }

    /// @inheritdoc IPrizeVault
    function hasClaimed(uint256 drawId, address account) external view returns (bool) {
        return _claimed[drawId][account];
    }

    /// @notice Prize committed to a draw.
    function lockedPrize(uint256 drawId) external view returns (uint64) {
        return _lockedPrize[drawId];
    }
}
