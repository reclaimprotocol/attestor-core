// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import {CoreDeploymentLib} from "./utils/CoreDeploymentLib.sol";

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import "@eigenlayer/contracts/permissions/PauserRegistry.sol";

import {IDelegationManager} from "@eigenlayer/contracts/interfaces/IDelegationManager.sol";
import {IAVSDirectory} from "@eigenlayer/contracts/interfaces/IAVSDirectory.sol";
import {IStrategyManager, IStrategy} from "@eigenlayer/contracts/interfaces/IStrategyManager.sol";
import {StrategyBaseTVLLimits} from "@eigenlayer/contracts/strategies/StrategyBaseTVLLimits.sol";
import "@eigenlayer/test/mocks/EmptyContract.sol";

import "@eigenlayer-middleware/src/RegistryCoordinator.sol" as regcoord;
import {IBLSApkRegistry, IIndexRegistry, IStakeRegistry} from "@eigenlayer-middleware/src/RegistryCoordinator.sol";
import {BLSApkRegistry} from "@eigenlayer-middleware/src/BLSApkRegistry.sol";
import {IndexRegistry} from "@eigenlayer-middleware/src/IndexRegistry.sol";
import {StakeRegistry} from "@eigenlayer-middleware/src/StakeRegistry.sol";
import "@eigenlayer-middleware/src/OperatorStateRetriever.sol";

import {ReclaimServiceManager, IServiceManager} from "../src/ReclaimServiceManager.sol";
import {ReclaimTaskManager} from "../src/ReclaimTaskManager.sol";
import {IReclaimTaskManager} from "../src/IReclaimTaskManager.sol";
import "../src/ERC20Mock.sol";

import "forge-std/Test.sol";
import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import "forge-std/console.sol";
import {StrategyFactory} from "@eigenlayer/contracts/strategies/StrategyFactory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ContractsRegistry} from "../src/test/ContractsRegistry.sol";
import {ReclaimDeploymentLib} from "../script/utils/ReclaimDeploymentLib.sol";
import {UpgradeableProxyLib} from "./utils/UpgradeableProxyLib.sol";

import {FundOperator} from "./utils/FundOperator.sol";
// # To deploy and verify our contract
// forge script script/ReclaimDeployer.s.sol:ReclaimDeployer --rpc-url $RPC_URL  --private-key $PRIVATE_KEY --broadcast -vvvv

contract ReclaimDeployer is Script {
    // DEPLOYMENT CONSTANTS
    uint256 public constant QUORUM_THRESHOLD_PERCENTAGE = 100;
    uint32 public constant TASK_RESPONSE_WINDOW_BLOCK = 30;
    uint32 public constant TASK_DURATION_BLOCKS = 0;
    address public AGGREGATOR_ADDR;
    address public TASK_GENERATOR_ADDR;
    address public CONTRACTS_REGISTRY_ADDR;
    address public OPERATOR_ADDR;
    address public OPERATOR_2_ADDR;
    ContractsRegistry contractsRegistry;

    StrategyBaseTVLLimits public erc20MockStrategy;

    address public rewardscoordinator;

    regcoord.RegistryCoordinator public registryCoordinator;
    regcoord.IRegistryCoordinator public registryCoordinatorImplementation;

    IBLSApkRegistry public blsApkRegistry;
    IBLSApkRegistry public blsApkRegistryImplementation;

    IIndexRegistry public indexRegistry;
    IIndexRegistry public indexRegistryImplementation;

    IStakeRegistry public stakeRegistry;
    IStakeRegistry public stakeRegistryImplementation;

    OperatorStateRetriever public operatorStateRetriever;

    ReclaimServiceManager public serviceManager;
    IServiceManager public serviceManagerImplementation;

    CoreDeploymentLib.DeploymentData internal configData;
    IStrategy strategy;
    address private deployer;
    IERC20 public erc20Mock;
    ReclaimDeploymentLib.DeploymentData deployment;

    using UpgradeableProxyLib for address;

    address proxyAdmin;

    function setUp() public virtual {
        deployer = vm.rememberKey(vm.envUint("PRIVATE_KEY"));
        vm.label(deployer, "Deployer");
    }

    function run() external {
        // Eigenlayer contracts
        vm.startBroadcast(deployer);
        ReclaimDeploymentLib.SetupConfig memory isConfig =
            ReclaimDeploymentLib.readSetupConfigJson("reclaim.json");
        configData = CoreDeploymentLib
            .readDeploymentJson("script/deployments/core/", block.chainid);

        // erc20Mock = new ERC20Mock();
        // FundOperator.fund_operator(address(erc20Mock), isConfig.operator_addr, 15000e18);
        // FundOperator.fund_operator(address(erc20Mock), isConfig.operator_2_addr, 30000e18);
        console.log("op 2", isConfig.operator_2_addr);
        // (bool s,) = isConfig.operator_2_addr.call{value: 0.1 ether}("");
        // require(s);
        strategy = IStrategy(configData.strategy);
        rewardscoordinator = configData.rewardsCoordinator;

        proxyAdmin = UpgradeableProxyLib.deployProxyAdmin();
        require(address(strategy) != address(0));
        deployment = ReclaimDeploymentLib.deployContracts(
            proxyAdmin, configData, address(strategy), isConfig, msg.sender
        );
        console.log("instantSlasher", deployment.slasher);

        // FundOperator.fund_operator(
        //     address(erc20Mock), deployment.serviceManager, 1e18
        // );
        deployment.token = address(strategy.underlyingToken());

        ReclaimDeploymentLib.writeDeploymentJson(deployment);

        vm.stopBroadcast();
    }
}