// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {ITicketLedger} from "../interfaces/ITicketLedger.sol";
import {IYieldSource} from "../interfaces/IYieldSource.sol";

/// @title A no-loss prize pool with confidential positions.
///
/// @dev ## What a participant reveals, and what they do not
///
/// Nothing about the size of their position. Deposits arrive as ciphertexts,
/// balances are stored as ciphertexts, and draw weight is derived
/// homomorphically without the pool ever holding a plaintext amount for any
/// account. Whether a deposit clears the bonus tier is hidden even from this
/// contract.
///
/// ## The one public aggregate, and why it exists
///
/// A lending venue holds real assets and knows how much it holds. No amount of
/// encryption on this side changes that, so pretending the pool's total is
/// secret would be theatre. `publishPrincipal` therefore decrypts the pool's
/// *total* principal — verified against KMS signatures — and syncs it to the
/// yield source.
///
/// The aggregate reveals nothing about its parts: knowing a pool holds
/// 1,000,000 says nothing about who holds what. This is the same line every
/// confidential protocol draws, and drawing it explicitly is better than
/// hiding a decryption somewhere less visible.
///
/// One aggregate is safe. A *stream* of them is not: two totals taken either
/// side of a single deposit differ by exactly that deposit. So snapshots are
/// rate-limited, and `requestPrincipalDisclosure` carries the argument for
/// how and why.
///
/// ## Withdrawals during a draw
///
/// Always allowed. A prize pool that locks deposits to run its own lottery has
/// broken the promise that makes it a savings product. The ledger's
/// copy-on-write keeps a sealed draw consistent regardless: an account that
/// exits mid-draw keeps the weight it had when the snapshot closed, and can
/// still win the prize it was already in the running for.
contract ConfidentialPrizePool is ZamaEthereumConfig, Ownable2Step {
    /// @notice The confidential token this pool accepts.
    IERC7984 public immutable asset;

    /// @notice Draw weights derived from the balances held here.
    ITicketLedger public immutable ledger;

    /// @notice Where principal earns yield.
    IYieldSource public immutable yieldSource;

    mapping(address account => euint64 balance) private _balance;

    /// @notice Total principal held, encrypted.
    euint64 private _totalPrincipal;

    /// @notice Total principal last published to the yield source.
    uint64 public publishedPrincipal;

    /// @notice Shortest gap between two snapshots of the encrypted total.
    ///
    /// @dev The number that stops the total from being differenced. See
    ///      `requestPrincipalDisclosure`.
    ///
    ///      Deliberately a constant with no setter. An interval the owner
    ///      could shorten is one an owner can remove, and the guarantee here
    ///      is meant to hold against this contract's operator as much as
    ///      against anyone else.
    uint64 public constant DISCLOSURE_INTERVAL = 1 hours;

    /// @notice When the last new snapshot was taken.
    uint64 public lastDisclosureAt;

    /// @dev The handle that snapshot was of. Re-marking it costs nothing and
    ///      reveals nothing, so it is exempt from the interval.
    bytes32 private _lastDisclosed;

    event Deposited(address indexed account);
    event Withdrawn(address indexed account);
    event PrincipalPublished(uint64 total, uint64 previous);
    event PrincipalDisclosureRequested(uint64 at);

    error NothingDeposited(address account);
    error PrincipalUnchanged(uint64 total);
    error NoPrincipalYet();
    error DisclosureTooSoon(uint64 allowedAt);

    constructor(
        address owner_,
        IERC7984 asset_,
        ITicketLedger ledger_,
        IYieldSource yieldSource_
    ) Ownable(owner_) {
        asset = asset_;
        ledger = ledger_;
        yieldSource = yieldSource_;
    }

    /// @notice Deposits a confidential amount into the pool.
    /// @param encryptedAmount Amount, encrypted client-side.
    /// @param inputProof Proof the ciphertext was formed correctly.
    /// @dev The transfer returns what actually moved, which may be less than
    ///      requested if the sender's balance could not cover it. ERC7984
    ///      cannot revert on that without revealing the balance, so the
    ///      credited amount is the transferred one, never the requested one.
    ///      Crediting the request instead would let anyone mint pool weight
    ///      out of an underfunded transfer.
    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));

        euint64 transferred = asset.confidentialTransferFrom(msg.sender, address(this), requested);

        _credit(msg.sender, transferred, true);
        emit Deposited(msg.sender);
    }

    /// @notice Withdraws a confidential amount from the pool.
    /// @dev Available in every draw state. See the contract note on why.
    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 balance = _balance[msg.sender];
        if (!FHE.isInitialized(balance)) revert NothingDeposited(msg.sender);

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);

        // Clamp to the balance rather than checking it. A comparison the pool
        // could branch on would have to be decrypted, which would publish the
        // account's balance to satisfy a withdrawal.
        euint64 amount = FHE.min(requested, balance);
        FHE.allowTransient(amount, address(asset));

        euint64 transferred = asset.confidentialTransfer(msg.sender, amount);

        _credit(msg.sender, transferred, false);
        emit Withdrawn(msg.sender);
    }

    /// @notice Publishes the pool's total principal to the yield source.
    /// @param cleartextTotal The decrypted total.
    /// @param decryptionProof KMS signatures over that value.
    /// @dev Permissionless: the value is checked against the KMS signatures
    ///      for this pool's own total handle, so a caller can submit the truth
    ///      or nothing.
    function publishPrincipal(uint64 cleartextTotal, bytes calldata decryptionProof) external {
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint64.unwrap(_totalPrincipal);

        FHE.checkSignatures(handles, abi.encode(cleartextTotal), decryptionProof);

        uint64 previous = publishedPrincipal;
        if (cleartextTotal == previous) revert PrincipalUnchanged(cleartextTotal);
        publishedPrincipal = cleartextTotal;

        if (cleartextTotal > previous) {
            yieldSource.depositPrincipal(cleartextTotal - previous);
        } else {
            yieldSource.withdrawPrincipal(previous - cleartextTotal);
        }

        emit PrincipalPublished(cleartextTotal, previous);
    }

    /// @notice Makes the pool's current total principal decryptable.
    ///
    /// @dev Separate from publishing because decryption happens off-chain
    ///      between the two: this marks the handle, the KMS produces the
    ///      cleartext, and `publishPrincipal` brings it back with proof.
    ///
    ///      ## Why this is rate-limited
    ///
    ///      Without an interval, publishing the total leaks the individual
    ///      amounts it is made of. The total changes on every deposit and
    ///      withdrawal, and `Deposited` names the account that moved, so an
    ///      observer could take a snapshot immediately before and after a
    ///      chosen deposit and recover it exactly by subtraction. Nothing
    ///      cryptographic fails in that attack: the ciphertexts hold and the
    ///      KMS proof is real. What fails is letting anyone ask for a
    ///      snapshot whenever they like.
    ///
    ///      An interval takes away the aiming. A snapshot can no longer be
    ///      placed around a transaction, only taken on a schedule nobody
    ///      controls, so what a difference reveals is the pool's *net* change
    ///      over an hour rather than one account's deposit.
    ///
    ///      It does not reduce the residue to nothing, and claiming otherwise
    ///      would be dishonest: if one account is the only one to move in a
    ///      whole interval, that hour's net change is its amount. That much
    ///      is inherent in publishing a total at all, and the pool says so
    ///      out loud rather than implying a total can be public and its parts
    ///      perfectly private at the same time.
    ///
    ///      Still permissionless, and deliberately so. The gate is *how
    ///      often*, not *by whom* — an owner-only version would close the
    ///      window for everyone except the one party with the best view of
    ///      who is depositing.
    function requestPrincipalDisclosure() external {
        if (!FHE.isInitialized(_totalPrincipal)) revert NoPrincipalYet();

        bytes32 current = euint64.unwrap(_totalPrincipal);

        // Re-marking the handle already disclosed is exempt. It is idempotent
        // and reveals nothing new, and making a failed publication wait an
        // hour to be retried would turn a hiccup into an outage.
        if (current != _lastDisclosed) {
            uint64 allowedAt = lastDisclosureAt + DISCLOSURE_INTERVAL;
            if (lastDisclosureAt != 0 && block.timestamp < allowedAt) {
                revert DisclosureTooSoon(allowedAt);
            }

            lastDisclosureAt = uint64(block.timestamp);
            _lastDisclosed = current;
            emit PrincipalDisclosureRequested(lastDisclosureAt);
        }

        FHE.makePubliclyDecryptable(_totalPrincipal);
    }

    /// @notice Handle to an account's confidential position.
    /// @dev Readable only by that account; the handle alone grants nothing.
    function balanceOf(address account) external view returns (euint64) {
        return _balance[account];
    }

    /// @notice Handle to the pool's total principal.
    function totalPrincipalHandle() external view returns (euint64) {
        return _totalPrincipal;
    }

    /// @dev Applies a balance change and re-derives the account's draw weight.
    function _credit(address account, euint64 amount, bool increase) private {
        euint64 balance = _balance[account];
        euint64 updated;

        if (increase) {
            updated = FHE.isInitialized(balance) ? FHE.add(balance, amount) : amount;
            _totalPrincipal = FHE.isInitialized(_totalPrincipal)
                ? FHE.add(_totalPrincipal, amount)
                : amount;
        } else {
            updated = FHE.sub(balance, amount);
            _totalPrincipal = FHE.sub(_totalPrincipal, amount);
        }

        FHE.allowThis(updated);
        FHE.allow(updated, account);
        FHE.allowThis(_totalPrincipal);
        _balance[account] = updated;

        // Weight is re-derived here, at the moment the balance moves, so the
        // account causing the change pays its homomorphic cost and sealing a
        // draw stays constant-time.
        FHE.allowTransient(updated, address(ledger));
        ledger.sync(account, updated);
    }
}
