// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/**
 * Utilities for bytes manipulation & conversion
 */
library BytesUtils {

	function bytesToUInt(bytes memory data, uint offset) internal pure returns (uint) {
		require(offset + 4 <= data.length, "Offset + 4 must be within data bounds");
        
        uint32 result;
        assembly {
            // Load the 32 bits (4 bytes) from the data at the given offset into the result variable
            result := mload(add(add(data, 0x4), offset))
        }
        
        return result;
	}
}