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
	 * Default task creation metadata.
	 */
	TaskCreationMetadata public taskCreationMetadata;

    // mapping of task indices to all tasks hashes
    // when a task is created, task hash is stored here,
    // and responses need to pass the actual task,
    // which is hashed onchain and checked against this mapping
	// Note: I'm guessing task hashes are stored to reduce gas costs
    mapping(uint32 => bytes32) public allTaskHashes;

    /**
     * Operators whitelisted to respond to tasks.
     */
    address[] public whitelistedOperators;
    /**
     * Admins of the contract.
     */
    address[] public admins;

	OperatorMetadata[] public registeredOperators;

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

    function setup(address initialAdmin) external initializer {
        taskCreationMetadata = TaskCreationMetadata(
            // 30m
            30 * 60,
            // 1m
            1,
            // 5m
            5 * 60
        );
        admins.push(initialAdmin);
    }

    /* FUNCTIONS */

    /// @inheritdoc IServiceManagerUI
    function updateAVSMetadataURI(
        string memory _metadataURI
    ) external override virtual onlyAdmin {
        _updateAVSMetadataURI(_metadataURI);
    }

    function updateTaskCreationMetadata(
        TaskCreationMetadata memory newMetadata
    ) external onlyAdmin {
        if(newMetadata.maxTaskLifetimeS != 0) {
            taskCreationMetadata.maxTaskLifetimeS = newMetadata
                .maxTaskLifetimeS;
        }

        if(newMetadata.minSignaturesPerTask != 0) {
            taskCreationMetadata.minSignaturesPerTask = newMetadata
                .minSignaturesPerTask;
        }

        if(newMetadata.maxTaskCreationDelayS != 0) {
            taskCreationMetadata.maxTaskCreationDelayS = newMetadata
                .maxTaskCreationDelayS;
        }
    }

    function whitelistAddressAsOperator(
        address operator,
        bool isWhitelisted
    ) external onlyAdmin {
        if(isWhitelisted) {
            whitelistedOperators.push(operator);
            return;
        }

        for(uint i = 0; i < whitelistedOperators.length; i++) {
            if(whitelistedOperators[i] == operator) {
                delete whitelistedOperators[i];
                return;
            }
        }

        revert("Operator not found");
    }

    function registerOperatorToAVS(
        address operator,
        ISignatureUtils.SignatureWithSaltAndExpiry memory operatorSignature
    ) external virtual override onlyStakeRegistry {
        require(isOperatorWhitelisted(operator), "Operator not whitelisted");
        _registerOperatorToAVS(operator, operatorSignature);
    }

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
    function createNewTask(
        ClaimRequest memory request,
        bytes memory requestSignature
    ) external {
        if(request.owner != msg.sender) {
            bytes memory encodedReq = abi.encode(request);
            address signer = Claims.verifySignature(encodedReq, requestSignature);
            require(signer == request.owner, "Signer of requestSignature is not request.owner");
        }

        uint32 diff = absDiff(request.requestedAt, uint32(block.timestamp));
        require(diff <= taskCreationMetadata.maxTaskCreationDelayS, "Request timestamp too far away");

        // create a new task struct
        Task memory newTask;
        newTask.request = request;
		newTask.createdAt = uint32(block.timestamp);
		newTask.expiresAt = uint32(
            newTask.createdAt + taskCreationMetadata.maxTaskLifetimeS
        );
		newTask.minimumSignatures = taskCreationMetadata.minSignaturesPerTask;

		// hash before picking operators -- we'll use this
		// as the seed for randomness
		bytes32 preOpHash = keccak256(abi.encode(newTask));
		newTask.operators = pickRandomOperators(
			taskCreationMetadata.minSignaturesPerTask,
			uint256(preOpHash)
		);
        // store hash of task onchain, emit event, and increase taskNum
        allTaskHashes[latestTaskNum] = keccak256(abi.encode(newTask));
        emit NewTaskCreated(latestTaskNum, newTask);
        latestTaskNum = latestTaskNum + 1;
    }

    function encodeClaimRequest(ClaimRequest memory request) public pure returns (bytes memory) {
        return abi.encode(request);
    }

    function checkSignerAddress(
        ClaimRequest memory request,
        bytes memory requestSignature
    ) public pure returns (address) {
        bytes memory encodedReq = abi.encode(request);
        return Claims.verifySignature(encodedReq, requestSignature);
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

        require(
            completedTask.task.expiresAt > uint32(block.timestamp),
            "Task has expired"
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

        // remove so it cannot be claimed again
        delete allTaskHashes[referenceTaskIndex];

        // TODO: distribute fees

		emit TaskCompleted(referenceTaskIndex, completedTask);
	}

    // HELPER

    // for a whitelist to count -- operator must either be whitelisted
    // or be an admin
    function isOperatorWhitelisted(address operator) public view returns (bool) {
        if(isAdmin(operator)) {
            return true;
        }

        for(uint i = 0; i < whitelistedOperators.length; i++) {
            if(whitelistedOperators[i] == operator) {
                return true;
            }
        }

        return false;
    }

    function operatorHasMinimumWeight(address operator) public view returns (bool) {
        uint opWeight = ECDSAStakeRegistry(stakeRegistry)
            .getOperatorWeight(operator);
        uint minWeight = ECDSAStakeRegistry(stakeRegistry).minimumWeight();
        return opWeight >= minWeight;
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
		uint256 left = temp.length;

		Operator[] memory output = new Operator[](count);
		for (uint8 i = 0; i < output.length;) {
			require(
				left > 0,
				"Internal: Fees too low. No operators left to pick from."
			);
			uint256 idx = Random.random(seed + i) % left;
			OperatorMetadata memory item = temp[idx];
			// we've utilised operator at index "idx"
			// we of course don't want to pick the same operator twice
			// so we remove it from the list of operators
			// and reduce the number of operators left to pick from
			// since solidity doesn't support "pop()" in memory arrays
			// we swap the last element with the element we want to remove
			temp[idx] = temp[left - 1];
			left -= 1;

			if(!operatorHasMinimumWeight(item.addr)) {
				continue;
			}

			output[i].addr = item.addr;
			output[i].url = item.url;
			i++;
		}

		return output;
	}

    function absDiff(uint32 a, uint32 b) internal pure returns (uint32) {
        return a > b ? a - b : b - a;
    }

    function isAdmin(address _admin) public view returns (bool) {
        if(msg.sender == owner()) {
            return true;
        }

        for(uint i = 0; i < admins.length; i++) {
            if(admins[i] == _admin) {
                return true;
            }
        }

        return false;
    }

    modifier onlyAdmin {
        require(isAdmin(msg.sender), "Caller is not admin");
        _;
    }
}