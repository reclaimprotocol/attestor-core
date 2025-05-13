// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import {SlashingRegistryCoordinator} from "@eigenlayer-middleware/src/SlashingRegistryCoordinator.sol";
import { IStakeRegistry } from "@eigenlayer-middleware/src/interfaces/IStakeRegistry.sol";
import { IBLSApkRegistry } from "@eigenlayer-middleware/src/interfaces/IBLSApkRegistry.sol";
import { IIndexRegistry } from "@eigenlayer-middleware/src/interfaces/IIndexRegistry.sol";
import { ISocketRegistry } from "@eigenlayer-middleware/src/interfaces/ISocketRegistry.sol";
import { IAllocationManager } from "@eigenlayer/contracts/interfaces/IAllocationManager.sol";
import { IPauserRegistry } from "@eigenlayer/contracts/interfaces/IPauserRegistry.sol";
import { ReclaimServiceManager } from "./ReclaimServiceManager.sol";

contract ReclaimSlashingRegistryCoordinator is SlashingRegistryCoordinator {

	constructor(
		IStakeRegistry _stakeRegistry,
		IBLSApkRegistry _blsApkRegistry,
		IIndexRegistry _indexRegistry,
		ISocketRegistry _socketRegistry,
		IAllocationManager _allocationManager,
		IPauserRegistry _pauserRegistry,
		string memory _version
	)
		SlashingRegistryCoordinator(
			_stakeRegistry,
			_blsApkRegistry,
			_indexRegistry,
			_socketRegistry,
			_allocationManager,
			_pauserRegistry,
			_version
		) {}

	/// @dev Hook to allow for any pre-register logic in `_registerOperator`
	function _beforeRegisterOperator(
			address operator,
			bytes32 operatorId,
			bytes memory quorumNumbers,
			uint192 currentBitmap
	) internal virtual override {
		super._beforeRegisterOperator(
			operator, operatorId, quorumNumbers, currentBitmap
		);

		require(
			ReclaimServiceManager(avs).isOperatorWhitelisted(operator),
			"ReclaimSlashingRegistryCoordinator: operator not whitelisted"
		);
	}
}