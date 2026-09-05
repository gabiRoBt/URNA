// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @title A confidential token with open minting, for tests only.
/// @dev Never deploy this. `mint` is unguarded so a test can fund accounts
///      without a faucet or a supply schedule getting in the way. Everything
///      below it is stock ERC7984, so the pool exercises the same transfer
///      path it will use in production.
contract ConfidentialTokenMock is ERC7984, ZamaEthereumConfig {
    constructor(string memory name_, string memory symbol_)
        ERC7984(name_, symbol_, "")
    {}

    /// @notice Mints a plaintext amount to an account.
    /// @dev Amount is plaintext because a test knows what it is funding; the
    ///      balance it lands in is still confidential.
    function mint(address to, uint64 amount) external returns (euint64) {
        euint64 encrypted = FHE.asEuint64(amount);
        FHE.allowThis(encrypted);
        return _mint(to, encrypted);
    }
}
