// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// implementation from: https://stackoverflow.com/a/67332959
// Utils for random number generation
library Random {
	/**
	 * @dev generates a random number from the given seed
	 * This will always return the same number for the same seed & block
	 */
	function random(uint256 seed) internal view returns (uint) {
		return uint(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, seed)));
	}
}
