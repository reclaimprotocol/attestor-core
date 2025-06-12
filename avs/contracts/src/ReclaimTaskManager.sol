// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@eigenlayer/contracts/core/DelegationManager.sol";
import {ECDSAServiceManagerBase} from "@eigenlayer-middleware/src/unaudited/ECDSAServiceManagerBase.sol";
import {IStakeRegistry} from "@eigenlayer-middleware/src/interfaces/IStakeRegistry.sol";
import "@openzeppelin-upgrades/contracts/utils/cryptography/ECDSAUpgradeable.sol";
import {OperatorStateRetriever} from "@eigenlayer-middleware/src/OperatorStateRetriever.sol";
import "@eigenlayer/contracts/permissions/Pausable.sol";
import {IRegistryCoordinator} from "@eigenlayer-middleware/src/interfaces/IRegistryCoordinator.sol";
import {IStrategy} from "@eigenlayer/contracts/interfaces/IStrategy.sol";
import {IRewardsCoordinator} from "@eigenlayer/contracts/interfaces/IRewardsCoordinator.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { OwnableUpgradeable } from "@openzeppelin-upgrades/contracts/access/OwnableUpgradeable.sol";
import "./IReclaimTaskManager.sol";
import "./utils/Random.sol";
import "./utils/Claims.sol";

/**
 * @title Primary entrypoint for procuring services from Reclaim.
 */

contract ReclaimTaskManager is
	Initializable,
	Pausable,
	OwnableUpgradeable,
	OperatorStateRetriever,
	IReclaimTaskManager
{
    using ECDSAUpgradeable for bytes32;

    address public defaultStrategy;
    IRewardsCoordinator public rewardsCoordinator;
    IStakeRegistry public stakeRegistry;

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

    constructor(
        IStakeRegistry _stakeRegistry,
        IRewardsCoordinator _rewardsCoordinator,
	    IPauserRegistry _pauserRegistry
    ) Pausable(_pauserRegistry) {
			rewardsCoordinator = _rewardsCoordinator;
			stakeRegistry = _stakeRegistry;
		}

		function setRewardsCoordinator(IRewardsCoordinator _rewardsCoordinator) external onlyOwner {
				rewardsCoordinator = _rewardsCoordinator;
		}

		function setStakeRegistry(IStakeRegistry _stakeRegistry) external onlyOwner {
				stakeRegistry = _stakeRegistry;
		}

    function initialize(
        address initialOwner,
        address strategy
    ) external initializer {
        taskCreationMetadata = TaskCreationMetadata(
            // 30m
            30 * 60,
            // 1m
            1,
            // 5m
            5 * 60,
            // spend a little bit
            2
        );
        defaultStrategy = strategy;
    }

    /* FUNCTIONS */

    function updateTaskCreationMetadata(
        TaskCreationMetadata memory newMetadata
    ) external onlyOwner {
        if (newMetadata.maxTaskLifetimeS != 0) {
            taskCreationMetadata.maxTaskLifetimeS = newMetadata
                .maxTaskLifetimeS;
        }

        if (newMetadata.minSignaturesPerTask != 0) {
            taskCreationMetadata.minSignaturesPerTask = newMetadata
                .minSignaturesPerTask;
        }

        if (newMetadata.maxTaskCreationDelayS != 0) {
            taskCreationMetadata.maxTaskCreationDelayS = newMetadata
                .maxTaskCreationDelayS;
        }

        if (newMetadata.minFee != 0) {
            taskCreationMetadata.minFee = newMetadata.minFee;
        }
    }

    // NOTE: this function creates new task, assigns it a taskId
    function createNewTask(
        ClaimRequest memory request,
        bytes memory requestSignature
    ) external {
        require(taskCreationMetadata.minFee <= request.fee, "Fee too low");

        if (request.owner != msg.sender) {
            bytes memory encodedReq = abi.encode(request);
            address signer = Claims.verifySignature(
                encodedReq,
                requestSignature
            );
            require(
                signer == request.owner,
                "Signer of requestSignature is not request.owner"
            );
        }

        uint32 diff = _absDiff(request.requestedAt, uint32(block.timestamp));
        require(
            diff <= taskCreationMetadata.maxTaskCreationDelayS,
            "Request timestamp too far away"
        );

        IERC20 token = getToken();
        require(
            token.transferFrom(msg.sender, address(this), request.fee),
            "Failed to transfer fee"
        );

        // create a new task struct
        Task memory newTask;
        newTask.request = request;
        newTask.createdAt = uint32(block.timestamp);
        newTask.expiresAt = uint32(
            newTask.createdAt + taskCreationMetadata.maxTaskLifetimeS
        );
        newTask.minimumSignatures = taskCreationMetadata.minSignaturesPerTask;
        newTask.feePaid = request.fee;

        // hash before picking operators -- we'll use this
        // as the seed for randomness
        bytes32 preOpHash = keccak256(abi.encode(newTask));
        newTask.operators = _pickRandomOperators(
            taskCreationMetadata.minSignaturesPerTask,
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
        for (uint256 i = 0; i < operatorAddrs.length; i++) {
            operatorAddrs[i] = completedTask.task.operators[i].addr;
        }

        Claims.assertValidSignedClaim(signedClaim, operatorAddrs);

        // remove so it cannot be claimed again
        delete allTaskHashes[referenceTaskIndex];

        // distribute reward
        _distributeReward(operatorAddrs, completedTask.task.feePaid);

        emit TaskCompleted(referenceTaskIndex, completedTask);
    }

    // HELPER

    function _distributeReward(
        address[] memory operatorAddrs,
        uint256 reward
    ) internal {
        _sortAddresses(operatorAddrs);
        // distribute reward
        IRewardsCoordinator coordinator = IRewardsCoordinator(
            rewardsCoordinator
        );
        IERC20 token = getToken();

        IRewardsCoordinator.StrategyAndMultiplier[]
            memory strats = new IRewardsCoordinator.StrategyAndMultiplier[](1);
        strats[0].strategy = IStrategy(defaultStrategy);
        strats[0].multiplier = 1;

        IRewardsCoordinator.OperatorReward[]
            memory ops = new IRewardsCoordinator.OperatorReward[](
                operatorAddrs.length
            );
        uint256 perOpReward = reward / operatorAddrs.length;
        for (uint256 i = 0; i < operatorAddrs.length; i++) {
            ops[i].operator = operatorAddrs[i];
            ops[i].amount = perOpReward;
        }

        IRewardsCoordinator.OperatorDirectedRewardsSubmission[]
            memory subs = new IRewardsCoordinator.OperatorDirectedRewardsSubmission[](
                1
            );
        subs[0].strategiesAndMultipliers = strats;
        subs[0].token = getToken();
        subs[0].operatorRewards = ops;

        // taken from hello-world example
        uint32 calcIntervalS = coordinator.CALCULATION_INTERVAL_SECONDS();
        uint32 endStamp = coordinator.currRewardsCalculationEndTimestamp();
        if (endStamp == 0) {
            subs[0].startTimestamp =
                uint32(block.timestamp) -
                (uint32(block.timestamp) % calcIntervalS);
        } else {
            subs[0].startTimestamp =
                endStamp -
                coordinator.MAX_REWARDS_DURATION() +
                calcIntervalS;
        }

        // taken from hello-world example
        subs[0].duration = 0;
        subs[0].description = "Claim creation on AVS";

        // call directly on rewardscoordinator, as this contract has already
        // received the fees
        token.approve(address(rewardsCoordinator), reward);
        coordinator.createOperatorDirectedAVSRewardsSubmission(
            address(this),
            subs
        );
    }

    function encodeClaimRequest(
        ClaimRequest memory request
    ) public pure returns (bytes memory) {
        return abi.encode(request);
    }

    function getToken() public view returns (IERC20) {
        return IStrategy(defaultStrategy).underlyingToken();
    }

    function operatorHasMinimumWeight(
        address operator
    ) public view returns (bool) {
        // uint256 opWeight = ECDSAStakeRegistry(stakeRegistry).getOperatorWeight(
        //     operator
        // );
        // uint256 minWeight = ECDSAStakeRegistry(stakeRegistry).minimumWeight();
        // return opWeight >= minWeight;
        return true;
    }

    /**
     * @dev Pick a random set of operators from the available list
     * @param count number of operators to pick
     * @param seed Seed to use for randomness
     * @return Array of the selected operators
     */
    function _pickRandomOperators(
        uint8 count,
        uint256 seed
    ) internal view returns (ReclaimOperator[] memory) {
		OperatorMetadata[] memory registeredOperators = _getRegisteredOperators();
        require(
            count <= registeredOperators.length,
            "Internal: Not enough operators"
        );
        OperatorMetadata[] memory temp = registeredOperators;
        uint256 left = temp.length;

        ReclaimOperator[] memory output = new ReclaimOperator[](count);
        for (uint8 i = 0; i < output.length; ) {
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

            if (!operatorHasMinimumWeight(item.addr)) {
                continue;
            }

            output[i].addr = item.addr;
            output[i].url = item.url;
            i++;
        }

        return output;
    }

		function _getRegisteredOperators() internal view returns (OperatorMetadata[] memory) {
				OperatorMetadata[] memory operators = new OperatorMetadata[](0);
				revert("Not implemented");
				return operators;
		}

		function getTaskCreationMetadata()
				external
				view
				returns (TaskCreationMetadata memory)
		{
				return taskCreationMetadata;
		}

		function getLatestTaskNum() external view returns (uint32) {
				return latestTaskNum;
		}

    function _sortAddresses(address[] memory addresses) internal pure {
        for (uint256 i = 0; i < addresses.length; i++) {
            for (uint256 j = i + 1; j < addresses.length; j++) {
                if (addresses[i] > addresses[j]) {
                    address temp = addresses[i];
                    addresses[i] = addresses[j];
                    addresses[j] = temp;
                }
            }
        }
    }

    function _absDiff(uint32 a, uint32 b) internal pure returns (uint32) {
        return a > b ? a - b : b - a;
    }
}
