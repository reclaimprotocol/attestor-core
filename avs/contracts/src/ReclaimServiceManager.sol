// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "./IReclaimTaskManager.sol";
import "@eigenlayer-middleware/src/ServiceManagerBase.sol";
import {IAllocationManager, IAllocationManagerTypes} from "@eigenlayer/contracts/interfaces/IAllocationManager.sol";
import {IRewardsCoordinator} from "@eigenlayer/contracts/interfaces/IRewardsCoordinator.sol";
import {ISlashingRegistryCoordinator} from "@eigenlayer-middleware/src/interfaces/ISlashingRegistryCoordinator.sol";
import {IAVSRegistrar} from "@eigenlayer/contracts/interfaces/IAVSRegistrar.sol";

/**
 * @title Primary entrypoint for procuring services from Reclaim.
 * @author Layr Labs, Inc.
 */
contract ReclaimServiceManager is ServiceManagerBase, IAVSRegistrar {
	IReclaimTaskManager public immutable taskManager;
	ISlashingRegistryCoordinator public immutable slashingRegistryCoordinator;

	address[] public whitelistedOperators;

	/// @notice when applied to a function, ensures that the function
	// is only callable by the `registryCoordinator`.
	modifier onlyTaskManager() {
		require(
			msg.sender == address(taskManager),
			"onlyTaskManager: not from reclaim task manager"
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
		slashingRegistryCoordinator = _slashingRegistryCoordinator;
	}

	function registerOperator(
		address operator,
		address avs,
		uint32[] calldata operatorSetIds,
		bytes calldata data
	) external {

	}

	function deregisterOperator(
		address operator,
		address avs, uint32[]
		calldata operatorSetIds
	) external {

	}

	function supportsAVS(
			address avs
	) external view returns (bool) {
		return true;
	}

	function registerOperatorSets(
		uint256[] calldata operatorSetIds
	) external {
		// For example, forward to SlashingRegistryCoordinator:
	}

	function initialize(
		address initialOwner,
		address rewardsInitiator
	) external initializer {
		__ServiceManagerBase_init(initialOwner, rewardsInitiator);
		whitelistedOperators = new address[](0);
		_allocationManager.setAVSRegistrar(
			address(this), slashingRegistryCoordinator
		);
		_allocationManager.updateAVSMetadataURI(
			address(this),
			"TODO"
		);

		_permissionController.setAppointee(
			address(this),
			address(slashingRegistryCoordinator),
			address(_allocationManager),
			IAllocationManager.createOperatorSets.selector
		);
	}

	function addOperatorToWhitelist(
		address operator
	) external onlyOwner {
		require(
			!isOperatorWhitelisted(operator),
			"addOperatorToWhitelist: operator already whitelisted"
		);

		whitelistedOperators.push(operator);
	}

	function removeOperatorFromWhitelist(
		address operator
	) external onlyOwner {
		require(
			isOperatorWhitelisted(operator),
			"removeOperatorFromWhitelist: operator not whitelisted"
		);

		for (uint256 i = 0; i < whitelistedOperators.length; i++) {
			if (whitelistedOperators[i] == operator) {
				whitelistedOperators[i] = whitelistedOperators[
					whitelistedOperators.length - 1
				];
				whitelistedOperators.pop();
				break;
			}
		}
	}

	function isOperatorWhitelisted(
		address operator
	) public view returns (bool) {
		for (uint256 i = 0; i < whitelistedOperators.length; i++) {
			if (whitelistedOperators[i] == operator) {
				return true;
			}
		}
		return false;
	}
}
