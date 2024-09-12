// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/**
 * Utilities for string manipulation & conversion
 */
library StringUtils {
	function address2str(address x) internal pure returns (string memory) {
		bytes memory s = new bytes(40);
		for (uint i = 0; i < 20; i++) {
			bytes1 b = bytes1(uint8(uint(uint160(x)) / (2 ** (8 * (19 - i)))));
			bytes1 hi = bytes1(uint8(b) / 16);
			bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
			s[2 * i] = getChar(hi);
			s[2 * i + 1] = getChar(lo);
		}
		return string(abi.encodePacked("0x", s));
	}

	function bytes2str(bytes memory buffer) internal pure returns (string memory) {
		// Fixed buffer size for hexadecimal convertion
		bytes memory converted = new bytes(buffer.length * 2);
		bytes memory _base = "0123456789abcdef";

		for (uint256 i = 0; i < buffer.length; i++) {
			converted[i * 2] = _base[uint8(buffer[i]) / _base.length];
			converted[i * 2 + 1] = _base[uint8(buffer[i]) % _base.length];
		}

		return string(abi.encodePacked("0x", converted));
	}

	function getChar(bytes1 b) internal pure returns (bytes1 c) {
		if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
		else return bytes1(uint8(b) + 0x57);
	}

	function bool2str(bool _b) internal pure returns (string memory _uintAsString) {
		if (_b) {
			return "true";
		} else {
			return "false";
		}
	}

	function uint2str(uint _i) internal pure returns (string memory _uintAsString) {
		if (_i == 0) {
			return "0";
		}
		uint j = _i;
		uint len;
		while (j != 0) {
			len++;
			j /= 10;
		}
		bytes memory bstr = new bytes(len);
		uint k = len;
		while (_i != 0) {
			k = k - 1;
			uint8 temp = (48 + uint8(_i - (_i / 10) * 10));
			bytes1 b1 = bytes1(temp);
			bstr[k] = b1;
			_i /= 10;
		}
		return string(bstr);
	}

	function areEqual(
		string calldata _a,
		string storage _b
	) internal pure returns (bool) {
		return keccak256(abi.encodePacked((_a))) == keccak256(abi.encodePacked((_b)));
	}
}
