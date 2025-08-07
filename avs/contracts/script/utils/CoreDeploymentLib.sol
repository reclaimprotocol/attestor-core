// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IPermissionController} from "@eigenlayer/contracts/interfaces/IPermissionController.sol";
import {PermissionController} from "@eigenlayer/contracts/permissions/PermissionController.sol";
import {DelegationManager} from "@eigenlayer/contracts/core/DelegationManager.sol";
import {AllocationManager} from "@eigenlayer/contracts/core/AllocationManager.sol";
import {StrategyManager} from "@eigenlayer/contracts/core/StrategyManager.sol";
import {AVSDirectory} from "@eigenlayer/contracts/core/AVSDirectory.sol";
import {EigenPodManager} from "@eigenlayer/contracts/pods/EigenPodManager.sol";
import {RewardsCoordinator} from "@eigenlayer/contracts/core/RewardsCoordinator.sol";
import {IRewardsCoordinatorTypes} from "@eigenlayer/contracts/interfaces/IRewardsCoordinator.sol";
import {StrategyBase} from "@eigenlayer/contracts/strategies/StrategyBase.sol";
import {EigenPod} from "@eigenlayer/contracts/pods/EigenPod.sol";
import {IETHPOSDeposit} from "@eigenlayer/contracts/interfaces/IETHPOSDeposit.sol";
import {StrategyBaseTVLLimits} from "@eigenlayer/contracts/strategies/StrategyBaseTVLLimits.sol";
import {PauserRegistry} from "@eigenlayer/contracts/permissions/PauserRegistry.sol";
import {IStrategy} from "@eigenlayer/contracts/interfaces/IStrategy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISignatureUtilsMixin} from "@eigenlayer/contracts/interfaces/ISignatureUtilsMixin.sol";
import {IDelegationManager} from "@eigenlayer/contracts/interfaces/IDelegationManager.sol";
import {IBeacon} from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import {IStrategyManager} from "@eigenlayer/contracts/interfaces/IStrategyManager.sol";
import {IEigenPodManager} from "@eigenlayer/contracts/interfaces/IEigenPodManager.sol";
import {IAVSDirectory} from "@eigenlayer/contracts/interfaces/IAVSDirectory.sol";
import {IPauserRegistry} from "@eigenlayer/contracts/interfaces/IPauserRegistry.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {StrategyFactory} from "@eigenlayer/contracts/strategies/StrategyFactory.sol";
import {IAllocationManager} from "@eigenlayer/contracts/interfaces/IAllocationManager.sol";
import {UpgradeableProxyLib} from "./UpgradeableProxyLib.sol";

library CoreDeploymentLib {
    using stdJson for *;
    using Strings for *;
    using UpgradeableProxyLib for address;

    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct DeploymentData {
        address delegationManager;
        address avsDirectory;
        address strategyManager;
        address eigenPodManager;
        address allocationManager;
        address rewardsCoordinator;
        address eigenPodBeacon;
        address pauserRegistry;
        address strategyFactory;
        address strategyBeacon;
        address permissionController;
        address strategy;
    }

    function readDeploymentJson(string memory directoryPath, uint256 chainId) public returns (DeploymentData memory) {
        return readDeploymentJson(directoryPath, string.concat(vm.toString(chainId), ".json"));
    }

    function readDeploymentJson(string memory path, string memory fileName) internal returns (DeploymentData memory) {
        string memory pathToFile = string.concat(path, fileName);

        require(vm.exists(pathToFile), "Deployment file does not exist");

        string memory json = vm.readFile(pathToFile);

        DeploymentData memory data;
        data.strategy = json.readAddress(".addresses.strategy");
        data.strategyFactory = json.readAddress(".addresses.strategyManager");
        data.strategyManager = json.readAddress(".addresses.strategyManager");
        data.eigenPodManager = json.readAddress(".addresses.eigenPodManager");
        data.delegationManager = json.readAddress(".addresses.delegationManager");
        data.avsDirectory = json.readAddress(".addresses.avsDirectory");
        data.rewardsCoordinator = json.readAddress(".addresses.rewardsCoordinator");
        data.allocationManager = json.readAddress(".addresses.allocationManager");
        data.permissionController = json.readAddress(".addresses.permissionController");
        data.pauserRegistry = json.readAddress(".addresses.eigenLayerPauserReg");

        return data;
    }
}