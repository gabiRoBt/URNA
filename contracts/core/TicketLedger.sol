// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {ITicketLedger} from "../interfaces/ITicketLedger.sol";
import {IWeightPolicy} from "../interfaces/IWeightPolicy.sol";

/// @title The register of draw weights.
///
/// @dev ## Why sealing is O(1)
///
/// The obvious way to snapshot a pool is to copy every weight when the draw
/// opens. That makes sealing itself a batched, multi-transaction affair, and
/// it charges the whole pool's homomorphic cost to whoever happens to trigger
/// the draw.
///
/// This ledger inverts it. Weight is derived when a balance moves, so the
/// account that deposits pays for its own weight, once. Sealing then records
/// two numbers: which draw is frozen and how many positions it covers.
///
/// A frozen view still has to survive later balance changes, which is what the
/// copy-on-write below is for: an account that moves *after* a seal preserves
/// its old weight into the snapshot immediately before overwriting the live
/// one. Only accounts that actually move pay that cost, and they pay it once
/// per draw.
///
/// ## Why the participant list only grows
///
/// Traversal order is load-bearing. The draw engine walks positions as a
/// prefix sum across several transactions, so an index that means one account
/// in batch one and a different account in batch two would corrupt the walk
/// silently. Compaction is therefore only safe while no draw is sealed, and
/// this contract does not attempt it: an account that withdraws everything
/// stays in the list carrying zero weight, which costs a storage read per draw
/// and can never win.
///
/// For a pool that churns heavily over a long life this is a real cost, and
/// the honest fix is compaction gated on the `Open` state rather than anything
/// clever inside the walk.
contract TicketLedger is ITicketLedger, ZamaEthereumConfig, Ownable2Step {
    /// @notice The pool permitted to sync balances.
    address public writer;

    /// @notice The draw engine permitted to seal and release.
    address public sealer;

    /// @notice Rule that converts balance into draw weight.
    IWeightPolicy public immutable policy;

    address[] private _participants;

    /// @dev One-based so that zero reads as "not a participant".
    mapping(address account => uint256 indexPlusOne) private _indexPlusOne;

    mapping(address account => euint64 weight) private _weight;

    /// @notice Sum of every live weight, maintained incrementally.
    /// @dev Kept as a running total rather than summed at seal time. Summing
    ///      would be another O(n) homomorphic walk with its own depth ceiling
    ///      and its own batching; maintaining it costs one sub and one add per
    ///      balance change, charged to the account making the change.
    euint64 private _totalWeight;

    /// @dev Zero when no draw is sealed. Only one draw may be frozen at a time.
    uint256 private _frozenDrawId;

    mapping(uint256 drawId => uint256 count) private _sealedCount;
    mapping(uint256 drawId => euint64 total) private _sealedTotalWeight;
    mapping(uint256 drawId => mapping(address account => euint64 weight)) private _preserved;
    mapping(uint256 drawId => mapping(address account => bool taken)) private _preservedFlag;

    error NotWriter(address caller);
    error NotSealer(address caller);
    error AlreadyWired();
    error DrawAlreadyFrozen(uint256 frozenDrawId);
    error DrawNotFrozen(uint256 drawId);
    error IndexOutOfRange(uint256 index, uint256 count);

    modifier onlyWriter() {
        if (msg.sender != writer) revert NotWriter(msg.sender);
        _;
    }

    modifier onlySealer() {
        if (msg.sender != sealer) revert NotSealer(msg.sender);
        _;
    }

    constructor(address owner_, IWeightPolicy policy_) Ownable(owner_) {
        policy = policy_;
    }

    /// @notice Binds the pool and engine that may write to this ledger.
    /// @dev One-time. The pool and the engine each need a reference to the
    ///      ledger at construction, so they cannot both be known when the
    ///      ledger is deployed; wiring closes the cycle exactly once and then
    ///      makes itself unavailable.
    function wire(address writer_, address sealer_) external onlyOwner {
        if (writer != address(0) || sealer != address(0)) revert AlreadyWired();
        writer = writer_;
        sealer = sealer_;
    }

    /// @inheritdoc ITicketLedger
    function sync(address account, euint64 balance) external onlyWriter {
        uint256 indexPlusOne = _indexPlusOne[account];
        if (indexPlusOne == 0) {
            _participants.push(account);
            indexPlusOne = _participants.length;
            _indexPlusOne[account] = indexPlusOne;
            emit ParticipantJoined(account, indexPlusOne - 1);
        }

        // Preserve before overwriting, or the frozen draw would silently pick
        // up the new weight partway through its walk.
        _preserveForFrozenDraw(account);

        euint64 previous = _weight[account];

        // Access does not travel with the handle. The pool granted this ledger
        // transient access to the balance, and the ledger has to pass that on
        // explicitly before the policy can read it, let alone re-grant it.
        FHE.allowTransient(balance, address(policy));

        euint64 weight = policy.weigh(balance);
        FHE.allowThis(weight);

        // The engine reads weights from `weightAt`, which is a view function
        // and so cannot grant anything. Access has to be given here, when the
        // handle is produced, and it has to be persistent rather than
        // transient because the engine consumes it across later transactions.
        //
        // This grants compute access, not readability: the engine can add the
        // weight into a prefix sum but has no path to its plaintext.
        FHE.allow(weight, sealer);

        _weight[account] = weight;

        _updateTotalWeight(previous, weight);

        emit WeightSynced(account);
    }

    /// @inheritdoc ITicketLedger
    function seal(uint256 drawId) external onlySealer returns (uint256 participantCount_) {
        if (_frozenDrawId != 0) revert DrawAlreadyFrozen(_frozenDrawId);

        participantCount_ = _participants.length;
        _frozenDrawId = drawId;
        _sealedCount[drawId] = participantCount_;

        euint64 total = _totalWeight;
        if (FHE.isInitialized(total)) {
            _sealedTotalWeight[drawId] = total;
            FHE.allowThis(total);

            // The draw's total weight becomes public. This is what lets a third
            // party recompute every tier's draw point and check the outcome was
            // not steered, and it is also what makes the engine's comparison
            // against that point a scalar operation rather than a ciphertext
            // one. Handles are immutable, so later syncs produce a new total
            // and leave this one intact.
            FHE.makePubliclyDecryptable(total);
        }

        emit LedgerSealed(drawId, participantCount_);
    }

    /// @inheritdoc ITicketLedger
    function release(uint256 drawId) external onlySealer {
        if (_frozenDrawId != drawId) revert DrawNotFrozen(drawId);
        _frozenDrawId = 0;
        emit LedgerReleased(drawId);
    }

    /// @inheritdoc ITicketLedger
    function weightAt(uint256 drawId, uint256 index)
        external
        view
        returns (address account, euint64 weight)
    {
        uint256 count = _sealedCount[drawId];
        if (index >= count) revert IndexOutOfRange(index, count);

        account = _participants[index];
        weight = _preservedFlag[drawId][account] ? _preserved[drawId][account] : _weight[account];
    }

    /// @inheritdoc ITicketLedger
    function sealedCount(uint256 drawId) external view returns (uint256) {
        return _sealedCount[drawId];
    }

    /// @inheritdoc ITicketLedger
    function participantCount() external view returns (uint256) {
        return _participants.length;
    }

    /// @inheritdoc ITicketLedger
    function participantAt(uint256 index) external view returns (address) {
        if (index >= _participants.length) revert IndexOutOfRange(index, _participants.length);
        return _participants[index];
    }

    /// @notice Live weight of an account, outside any snapshot.
    /// @dev The handle alone grants nothing; reading it requires an ACL entry
    ///      this contract never issues to third parties.
    function liveWeight(address account) external view returns (euint64) {
        return _weight[account];
    }

    /// @notice The draw currently frozen, or zero.
    function frozenDrawId() external view returns (uint256) {
        return _frozenDrawId;
    }

    /// @notice Handle to the total weight frozen into `drawId`.
    /// @dev Marked publicly decryptable at seal time, so anyone can obtain the
    ///      cleartext from the KMS and submit it to the engine.
    function sealedTotalWeight(uint256 drawId) external view returns (euint64) {
        return _sealedTotalWeight[drawId];
    }

    /// @notice Handle to the current running total.
    function liveTotalWeight() external view returns (euint64) {
        return _totalWeight;
    }

    /// @dev Moves the running total from `previous` to `current`.
    function _updateTotalWeight(euint64 previous, euint64 current) private {
        euint64 total = _totalWeight;

        if (!FHE.isInitialized(total)) {
            // First position in the pool: the total is simply its weight. No
            // subtraction, so nothing can underflow on the very first sync.
            _totalWeight = current;
        } else {
            if (FHE.isInitialized(previous)) {
                total = FHE.sub(total, previous);
            }
            _totalWeight = FHE.add(total, current);
        }

        FHE.allowThis(_totalWeight);
    }

    /// @dev Copies an account's weight into the frozen snapshot, once.
    function _preserveForFrozenDraw(address account) private {
        uint256 drawId = _frozenDrawId;
        if (drawId == 0) return;
        if (_preservedFlag[drawId][account]) return;

        // A participant who joined after the seal is outside this draw's range
        // and must not be preserved into it: doing so would leave a weight
        // recorded against an index the walk never reaches, which is harmless
        // but misleading in the ledger's own state.
        if (_indexPlusOne[account] > _sealedCount[drawId]) return;

        euint64 current = _weight[account];
        if (FHE.isInitialized(current)) {
            FHE.allowThis(current);
            _preserved[drawId][account] = current;
        }
        _preservedFlag[drawId][account] = true;
    }
}
