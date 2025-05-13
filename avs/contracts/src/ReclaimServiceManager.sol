// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "./IReclaimTaskManager.sol";
import "@eigenlayer-middleware/src/ServiceManagerBase.sol";
import {IAllocationManager, IAllocationManagerTypes} from "@eigenlayer/contracts/interfaces/IAllocationManager.sol";
import {IRewardsCoordinator} from "@eigenlayer/contracts/interfaces/IRewardsCoordinator.sol";
import {ISlashingRegistryCoordinator} from "@eigenlayer-middleware/src/interfaces/ISlashingRegistryCoordinator.sol";

/**
 * @title Primary entrypoint for procuring services from Reclaim.
 * @author Layr Labs, Inc.
 */
contract ReclaimServiceManager is ServiceManagerBase {
	IReclaimTaskManager public immutable taskManager;

	/// @notice when applied to a function, ensures that the function is only callable by the `registryCoordinator`.
	modifier onlyTaskManager() {
		require(
			msg.sender == address(taskManager),
			"onlyTaskManager: not from credible squaring task manager"
		);
		_;
	}

	constructor(
		IAVSDirectory _avsDirectory,
		ISlashingRegistryCoordinator _slashingRegistryCoordinator,
		IStakeRegistry _stakeRegistry,
		address rewards_coordinator,
		IAllocationManager allocationManager,
		IPermissionController _permissionController,
		IReclaimTaskManager _taskManager
	)
		ServiceManagerBase(
			_avsDirectory,
			IRewardsCoordinator(rewards_coordinator),
			_slashingRegistryCoordinator,
			_stakeRegistry,
			_permissionController,
			allocationManager
		)
	{
		taskManager = _taskManager;
	}

	function initialize(
		address initialOwner,
		address rewardsInitiator
	) external initializer {
		__ServiceManagerBase_init(initialOwner, rewardsInitiator);
	}
}
