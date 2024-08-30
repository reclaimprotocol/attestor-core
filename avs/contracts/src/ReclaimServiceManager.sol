// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@eigenlayer/contracts/libraries/BytesLib.sol";
import "@eigenlayer/contracts/core/DelegationManager.sol";
import "@eigenlayer-middleware/src/unaudited/ECDSAServiceManagerBase.sol";
import "@eigenlayer-middleware/src/unaudited/ECDSAStakeRegistry.sol";
import "@openzeppelin-upgrades/contracts/utils/cryptography/ECDSAUpgradeable.sol";
import "@eigenlayer/contracts/permissions/Pausable.sol";
import {IRegistryCoordinator} from "@eigenlayer-middleware/src/interfaces/IRegistryCoordinator.sol";
import "./IReclaimServiceManager.sol";
import "./utils/Random.sol";
import "./utils/Claims.sol";

/**
 * @title Primary entrypoint for procuring services from Reclaim.
 */
contract ReclaimServiceManager is 
    ECDSAServiceManagerBase,
    IReclaimServiceManager,
    Pausable
{
    using BytesLib for bytes;
    using ECDSAUpgradeable for bytes32;

    /* STORAGE */
    // The latest task index
    uint32 public latestTaskNum;
	/**
	 * How long a task can be active for before it is considered
	 * expired
	 */
	uint32 public maxTaskLifetimeS;
	/**
	 * Minimum number of signatures required to complete the task.
	 */
	uint8 public minSignaturesPerTask;

    // mapping of task indices to all tasks hashes
    // when a task is created, task hash is stored here,
    // and responses need to pass the actual task,
    // which is hashed onchain and checked against this mapping
	// Note: I'm guessing task hashes are stored to reduce gas costs
    mapping(uint32 => bytes32) public allTaskHashes;

	OperatorMetadata[] public registeredOperators;

    // mapping of task indices to hash of abi.encode(taskResponse, taskResponseMetadata)
    mapping(address => mapping(uint32 => bytes)) public allTaskResponses;

    /* MODIFIERS */
    modifier onlyOperator() {
        require(
            ECDSAStakeRegistry(stakeRegistry).operatorRegistered(msg.sender) 
            == 
            true, 
            "Operator must be the caller"
        );
        _;
    }

    constructor(
        address _avsDirectory,
        address _stakeRegistry,
        address _delegationManager
    )
        ECDSAServiceManagerBase(
            _avsDirectory,
            _stakeRegistry,
            address(0), // TODO: payments
            _delegationManager
        )
    {}

    function setup() external initializer {
        minSignaturesPerTask = 1;
        // 30m
        maxTaskLifetimeS = 30 * 60;
    }

    function setMaxTaskLifetime(uint32 _maxTaskLifetimeS) external preferenceModification {
        maxTaskLifetimeS = _maxTaskLifetimeS;
    }

    function setMinSignaturesPerTask(uint8 _minSignaturesPerTask) external preferenceModification {
        minSignaturesPerTask = _minSignaturesPerTask;
    }

    /* FUNCTIONS */
    function updateOperatorMetadata(
        OperatorMetadata memory metadata
    ) external onlyOperator {
        require(
            metadata.addr == msg.sender,
            'Metadata address must match the caller'
        );

        bool isEmpty = bytes(metadata.url).length == 0;
        if(isEmpty) {
            for(uint i = 0; i < registeredOperators.length; i++) {
                if(registeredOperators[i].addr == metadata.addr) {
                    delete registeredOperators[i];
                    return;
                }
            }

            revert("Operator not found");
        }

        // update operator metadata
        for (uint i = 0; i < registeredOperators.length; i++) {
            if (registeredOperators[i].addr == metadata.addr) {
                registeredOperators[i] = metadata;
                return;
            }
        }

        registeredOperators.push(metadata);
    }

    function getMetadataForOperator(
        address operator
    ) external view returns (OperatorMetadata memory) {
        for (uint i = 0; i < registeredOperators.length; i++) {
            if (registeredOperators[i].addr == operator) {
                return registeredOperators[i];
            }
        }

        revert("Operator not found");
    }

    // NOTE: this function creates new task, assigns it a taskId
    function createNewTask(ClaimRequest memory request) external {
        // create a new task struct
        Task memory newTask;
        newTask.request = request;
		newTask.createdAt = uint32(block.timestamp);
		newTask.expiresAt = uint32(newTask.createdAt + maxTaskLifetimeS);
		newTask.minimumSignatures = minSignaturesPerTask;

		// hash before picking operators -- we'll use this
		// as the seed for randomness
		bytes32 preOpHash = keccak256(abi.encode(newTask));
		newTask.operators = pickRandomOperators(
			minSignaturesPerTask,
			uint256(preOpHash)
		);
        // store hash of task onchain, emit event, and increase taskNum
        allTaskHashes[latestTaskNum] = keccak256(abi.encode(newTask));
        emit NewTaskCreated(latestTaskNum, newTask);
        latestTaskNum = latestTaskNum + 1;
    }

	function taskCompleted(
		CompletedTask memory completedTask,
		uint32 referenceTaskIndex
	) external {
		// check that the task is valid, hasn't been responsed yet,
		// and is being responded in time
        require(
            keccak256(abi.encode(completedTask.task)) ==
                allTaskHashes[referenceTaskIndex],
            "supplied task does not match the one recorded in the contract"
        );

		Claims.SignedClaim memory signedClaim = Claims.SignedClaim(
            Claims.CompleteClaimData(
                completedTask.task.request.claimHash,
                completedTask.task.request.owner,
                completedTask.task.createdAt,
                1
            ),
            completedTask.signatures
        );

        address[] memory operatorAddrs = new address[](
            completedTask.task.operators.length
        );
        for (uint i = 0; i < operatorAddrs.length; i++) {
            operatorAddrs[i] = completedTask.task.operators[i].addr;
        }

        Claims.assertValidSignedClaim(signedClaim, operatorAddrs);

        // TODO: distribute fees

		emit TaskCompleted(referenceTaskIndex, completedTask);
	}

    // HELPER

    function operatorHasMinimumWeight(address operator) public view returns (bool) {
        return ECDSAStakeRegistry(stakeRegistry).getOperatorWeight(operator) >= ECDSAStakeRegistry(stakeRegistry).minimumWeight();
    }

	/**
	 * @dev Pick a random set of operators from the available list
	 * @param count number of operators to pick
	 * @param seed Seed to use for randomness
	 * @return Array of the selected operators
	 */
	function pickRandomOperators(
		uint8 count,
		uint256 seed
	) internal view returns (Operator[] memory) {
		require(
			count <= registeredOperators.length,
			"Internal: Not enough operators"
		);
		OperatorMetadata[] memory temp = registeredOperators;
		uint256 witnessesLeft = temp.length;

		Operator[] memory output = new Operator[](count);
		for (uint8 i = 0; i < output.length;) {
			require(
				witnessesLeft > 0,
				"Internal: Fees too low. No operators left to pick from."
			);
			uint256 idx = Random.random(seed + i) % witnessesLeft;
			OperatorMetadata memory item = temp[idx];
			// we've utilised witness at index "idx"
			// we of course don't want to pick the same witness twice
			// so we remove it from the list of witnesses
			// and reduce the number of witnesses left to pick from
			// since solidity doesn't support "pop()" in memory arrays
			// we swap the last element with the element we want to remove
			temp[idx] = temp[witnessesLeft - 1];
			witnessesLeft -= 1;

			if(!operatorHasMinimumWeight(item.addr)) {
				continue;
			}

			output[i].addr = item.addr;
			output[i].url = item.url;
			i++;
		}

		return output;
	}

    modifier preferenceModification {
        // TODO
        _;
    }
}