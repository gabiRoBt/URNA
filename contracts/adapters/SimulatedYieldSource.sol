// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IYieldSource} from "../interfaces/IYieldSource.sol";

/// @title A yield venue modelled rather than integrated.
///
/// @dev Lives under `adapters/` alongside where a real venue integration would
///      go — a Morpho or Aave adapter implementing the same interface. (The
///      directory is not called `yield/` because that generates TypeScript
///      bindings using a reserved word.)
///
/// ## What this is, plainly
///
/// This accrues yield on a fixed APY against elapsed time. It is a model of a
/// lending venue, not a connection to one, and it is labelled as such so no
/// reader mistakes a simulated return for a real one.
///
/// The choice is deliberate. Behind `IYieldSource` the pool cannot tell the
/// difference: it deposits principal, reclaims principal, and harvests what
/// accrued. Swapping this for a Morpho or Aave adapter changes where the yield
/// comes from and nothing about how a draw works. Building the model first
/// keeps the draw mechanics — which is where the actual difficulty lies —
/// verifiable without a testnet lending market in the loop.
///
/// ## The property that matters
///
/// Harvesting must never touch principal. A pool whose prize is funded from
/// deposits is not a no-loss prize pool, it is a slow way to lose money. The
/// accounting below separates the two strictly: `_totalPrincipal` moves only
/// on deposit and withdrawal, and accrual is computed against it without ever
/// drawing it down.
contract SimulatedYieldSource is IYieldSource, Ownable2Step {
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    /// @notice The pool permitted to move principal.
    address public pool;

    /// @notice The vault permitted to harvest yield.
    /// @dev A separate role from `pool` because they are separate concerns:
    ///      the pool owns participants' principal, the vault owns the prize.
    ///      Collapsing them would let whoever moves principal also take the
    ///      yield, which is the one boundary this contract exists to hold.
    address public harvester;

    /// @notice Annual percentage yield, in basis points.
    uint16 public apyBps;

    uint256 private _principal;
    uint256 private _accrued;
    uint256 private _lastAccrualAt;

    event ApyUpdated(uint16 previousApyBps, uint16 newApyBps);

    error NotPool(address caller);
    error NotHarvester(address caller);
    error AlreadyWired();
    error InsufficientPrincipal(uint256 requested, uint256 available);

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool(msg.sender);
        _;
    }

    modifier onlyHarvester() {
        if (msg.sender != harvester) revert NotHarvester(msg.sender);
        _;
    }

    /// @dev Accrues before every state change. Doing it as a modifier rather
    ///      than at each call site means a future method cannot silently skip
    ///      it and credit yield at the wrong principal.
    modifier accruing() {
        _accrue();
        _;
    }

    constructor(address owner_, uint16 apyBps_) Ownable(owner_) {
        apyBps = apyBps_;
        _lastAccrualAt = block.timestamp;
    }

    /// @notice Binds the pool that moves principal and the vault that harvests.
    function wire(address pool_, address harvester_) external onlyOwner {
        if (pool != address(0) || harvester != address(0)) revert AlreadyWired();
        pool = pool_;
        harvester = harvester_;
    }

    /// @notice Retunes the modelled rate.
    /// @dev Accrues first, so the change applies only to time after it.
    ///      Without that, raising the rate would retroactively pay yield that
    ///      was never earned at the old one.
    function setApy(uint16 newApyBps) external onlyOwner accruing {
        emit ApyUpdated(apyBps, newApyBps);
        apyBps = newApyBps;
    }

    /// @inheritdoc IYieldSource
    function depositPrincipal(uint256 amount) external onlyPool accruing {
        _principal += amount;
        emit PrincipalDeposited(amount, _principal);
    }

    /// @inheritdoc IYieldSource
    function withdrawPrincipal(uint256 amount) external onlyPool accruing {
        if (amount > _principal) revert InsufficientPrincipal(amount, _principal);
        _principal -= amount;
        emit PrincipalWithdrawn(amount, _principal);
    }

    /// @inheritdoc IYieldSource
    function harvest() external onlyHarvester accruing returns (uint256 harvested) {
        harvested = _accrued;
        _accrued = 0;
        emit YieldHarvested(harvested, block.timestamp);
    }

    /// @inheritdoc IYieldSource
    function pendingYield() external view returns (uint256) {
        return _accrued + _accrualSince();
    }

    /// @inheritdoc IYieldSource
    function totalPrincipal() external view returns (uint256) {
        return _principal;
    }

    function _accrue() private {
        _accrued += _accrualSince();
        _lastAccrualAt = block.timestamp;
    }

    /// @dev Simple interest over elapsed time. Not compounded: a compounding
    ///      model would need a fixed-point exponential whose rounding is far
    ///      harder to reason about, and the pool's behaviour does not depend
    ///      on which curve the yield followed.
    function _accrualSince() private view returns (uint256) {
        uint256 elapsed = block.timestamp - _lastAccrualAt;
        if (elapsed == 0 || _principal == 0 || apyBps == 0) return 0;
        return (_principal * apyBps * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }
}
