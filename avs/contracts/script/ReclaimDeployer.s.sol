// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/Test.sol";
import {ReclaimDeploymentLib} from "./utils/ReclaimDeploymentLib.sol";
import {CoreDeploymentLib} from "./utils/CoreDeploymentLib.sol";
import {UpgradeableProxyLib} from "./utils/UpgradeableProxyLib.sol";
import {StrategyBase} from "@eigenlayer/contracts/strategies/StrategyBase.sol";
import {ERC20Mock} from "../src/ERC20Mock.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {StrategyFactory} from "@eigenlayer/contracts/strategies/StrategyFactory.sol";
import {StrategyManager} from "@eigenlayer/contracts/core/StrategyManager.sol";
import {IRewardsCoordinator} from "@eigenlayer/contracts/interfaces/IRewardsCoordinator.sol";

import {
    Quorum,
    StrategyParams,
    IStrategy
} from "@eigenlayer-middleware/src/interfaces/IECDSAStakeRegistryEventsAndErrors.sol";

import "forge-std/Test.sol";

contract ReclaimDeployer is Script, Test {
    using CoreDeploymentLib for *;
    using UpgradeableProxyLib for address;

    address private deployer;
    address proxyAdmin;
    address rewardsOwner;
    address rewardsInitiator;
    IStrategy reclaimStrategy;
    CoreDeploymentLib.DeploymentData coreDeployment;
    ReclaimDeploymentLib.DeploymentData reclaimDeployment;
    ReclaimDeploymentLib.DeploymentConfigData reclaimConfig;
    Quorum internal quorum;
    ERC20Mock token;

    function setUp() public virtual {
        deployer = vm.rememberKey(vm.envUint("PRIVATE_KEY"));
        vm.label(deployer, "Deployer");

        reclaimConfig = ReclaimDeploymentLib.readDeploymentConfigValues("config/reclaim/", block.chainid);

        coreDeployment = CoreDeploymentLib.readDeploymentJson("deployments/core/", block.chainid);
    }

    function run() external {
        vm.startBroadcast(deployer);
        rewardsOwner = reclaimConfig.rewardsOwner;
        rewardsInitiator = reclaimConfig.rewardsInitiator;

        token = new ERC20Mock();
        reclaimStrategy = IStrategy(StrategyFactory(coreDeployment.strategyFactory).deployNewStrategy(token));

        quorum.strategies.push(StrategyParams({strategy: reclaimStrategy, multiplier: 10_000}));

        proxyAdmin = UpgradeableProxyLib.deployProxyAdmin();

        reclaimDeployment =
            ReclaimDeploymentLib.deployContracts(proxyAdmin, coreDeployment, quorum, deployer, address(reclaimStrategy));

        reclaimDeployment.strategy = address(reclaimStrategy);
        reclaimDeployment.token = address(token);

        vm.stopBroadcast();
        verifyDeployment();
        ReclaimDeploymentLib.writeDeploymentJson(reclaimDeployment);
    }

    function verifyDeployment() internal view {
        require(reclaimDeployment.stakeRegistry != address(0), "StakeRegistry address cannot be zero");
        require(reclaimDeployment.reclaimServiceManager != address(0), "ReclaimServiceManager address cannot be zero");
        require(reclaimDeployment.strategy != address(0), "Strategy address cannot be zero");
        require(proxyAdmin != address(0), "ProxyAdmin address cannot be zero");
        require(coreDeployment.delegationManager != address(0), "DelegationManager address cannot be zero");
        require(coreDeployment.avsDirectory != address(0), "AVSDirectory address cannot be zero");
    }
}
