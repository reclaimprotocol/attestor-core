// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.12;

import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IAVSDirectory} from "@eigenlayer/contracts/interfaces/IAVSDirectory.sol";
import {ISocketRegistry, SocketRegistry} from "@eigenlayer-middleware/src/SocketRegistry.sol";
import {
    ISlashingRegistryCoordinator,
    ISlashingRegistryCoordinatorTypes
} from "@eigenlayer-middleware/src/interfaces/ISlashingRegistryCoordinator.sol";
import {SlashingRegistryCoordinator} from "@eigenlayer-middleware/src/SlashingRegistryCoordinator.sol";
import {ReclaimSlashingRegistryCoordinator} from "../../src/ReclaimSlashingRegistryCoordinator.sol";
import {IPermissionController} from "@eigenlayer/contracts/interfaces/IPermissionController.sol";
import {IAVSRegistrar} from "@eigenlayer/contracts/interfaces/IAVSRegistrar.sol";
import {
    ReclaimServiceManager,
    IServiceManager
} from "../../src/ReclaimServiceManager.sol";
import {IReclaimTaskManager, ReclaimTaskManager} from "../../src/ReclaimTaskManager.sol";
import {IDelegationManager} from "@eigenlayer/contracts/interfaces/IDelegationManager.sol";
// import {Quorum} from "@eigenlayer-middleware/src/interfaces/IECDSAStakeRegistryEventsAndErrors.sol";
import {UpgradeableProxyLib} from "./UpgradeableProxyLib.sol";
import {CoreDeploymentLib} from "./CoreDeploymentLib.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {BLSApkRegistry} from "@eigenlayer-middleware/src/BLSApkRegistry.sol";
import {IndexRegistry} from "@eigenlayer-middleware/src/IndexRegistry.sol";
import {InstantSlasher} from "@eigenlayer-middleware/src/slashers/InstantSlasher.sol";
import {StakeRegistry} from "@eigenlayer-middleware/src/StakeRegistry.sol";
// import {SocketRegistry} from "@eigenlayer-middleware/src/SocketRegistry.sol"; // todo: socket registry not available
import {IAllocationManager} from "@eigenlayer/contracts/interfaces/IAllocationManager.sol";
import {IStrategy} from "@eigenlayer/contracts/interfaces/IStrategyManager.sol";
import {CoreDeploymentLib} from "./CoreDeploymentLib.sol";
import {IRewardsCoordinator} from "@eigenlayer/contracts/interfaces/IRewardsCoordinator.sol";

import {
    IBLSApkRegistry, IIndexRegistry, IStakeRegistry
} from
// ISocketRegistry
"@eigenlayer-middleware/src/SlashingRegistryCoordinator.sol";
import {IStakeRegistryTypes} from "@eigenlayer-middleware/src/interfaces/IStakeRegistry.sol";

import {PauserRegistry, IPauserRegistry} from "@eigenlayer/contracts/permissions/PauserRegistry.sol";
import {OperatorStateRetriever} from "@eigenlayer-middleware/src/OperatorStateRetriever.sol";

library ReclaimDeploymentLib {
    using stdJson for *;
    using Strings for *;
    using UpgradeableProxyLib for address;

    string internal constant MIDDLEWARE_VERSION = "v1.4.0-testnet-holesky";
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct DeploymentData {
        address serviceManager;
        address taskManager;
        address slashingRegistryCoordinator;
        address operatorStateRetriever;
        address blsapkRegistry;
        address indexRegistry;
        address stakeRegistry;
        address socketRegistry;
        address strategy;
        address pauserRegistry;
        address token;
        address slasher;
    }

    struct SetupConfig {
        uint256 numQuorums;
        uint256[] operatorParams;
        address operator_addr;
        address operator_2_addr;
        address contracts_registry_addr;
        address task_generator_addr;
        address aggregator_addr;
        address rewardsOwner;
        address rewardsInitiator;
        uint256 rewardsOwnerKey;
        uint256 rewardsInitiatorKey;
    }

    function deployContracts(
        address proxyAdmin,
        CoreDeploymentLib.DeploymentData memory core,
        address strategy,
        SetupConfig memory setupConfig,
        address admin
    ) internal returns (DeploymentData memory) {
        /// read EL deployment address
        CoreDeploymentLib.DeploymentData memory coredata =
            readCoreDeploymentJson("script/deployments/core/", block.chainid);
        address avsdirectory = coredata.avsDirectory;

        DeploymentData memory result;

        // First, deploy upgradeable proxy contracts that will point to the implementations.
        result.serviceManager = UpgradeableProxyLib.setUpEmptyProxy(proxyAdmin);
        result.stakeRegistry = UpgradeableProxyLib.setUpEmptyProxy(proxyAdmin);
        result.taskManager = UpgradeableProxyLib.setUpEmptyProxy(proxyAdmin);
        result.slashingRegistryCoordinator = UpgradeableProxyLib.setUpEmptyProxy(proxyAdmin);
        result.blsapkRegistry = UpgradeableProxyLib.setUpEmptyProxy(proxyAdmin);
        result.indexRegistry = UpgradeableProxyLib.setUpEmptyProxy(proxyAdmin);
        result.socketRegistry = UpgradeableProxyLib.setUpEmptyProxy(proxyAdmin);
        result.slasher = UpgradeableProxyLib.setUpEmptyProxy(proxyAdmin);
        OperatorStateRetriever operatorStateRetriever = new OperatorStateRetriever();
        result.strategy = strategy;
        result.operatorStateRetriever = address(operatorStateRetriever);
        // Deploy the implementation contracts, using the proxy contracts as inputs
        address stakeRegistryImpl = address(
            new StakeRegistry(
                ISlashingRegistryCoordinator(result.slashingRegistryCoordinator),
                IDelegationManager(core.delegationManager),
                IAVSDirectory(core.avsDirectory),
                IAllocationManager(core.allocationManager)
            )
        );

        address blsApkRegistryImpl =
            address(new BLSApkRegistry(ISlashingRegistryCoordinator(result.slashingRegistryCoordinator)));
        address indexRegistryimpl =
            address(new IndexRegistry(ISlashingRegistryCoordinator(result.slashingRegistryCoordinator)));
        address instantSlasherImpl = address(
            new InstantSlasher(
                IAllocationManager(core.allocationManager),
                ISlashingRegistryCoordinator(result.slashingRegistryCoordinator),
                result.taskManager
            )
        );

        address slashingRegistryCoordinatorImpl = address(
            new ReclaimSlashingRegistryCoordinator(
                IStakeRegistry(result.stakeRegistry),
                IBLSApkRegistry(result.blsapkRegistry),
                IIndexRegistry(result.indexRegistry),
                ISocketRegistry(result.socketRegistry),
                IAllocationManager(core.allocationManager),
                IPauserRegistry(coredata.pauserRegistry),
                MIDDLEWARE_VERSION
            )
        );

        address[] memory pausers = new address[](2);
        pausers[0] = admin;
        pausers[1] = admin;
        PauserRegistry pausercontract = new PauserRegistry(pausers, admin);

        IStrategy[] memory deployedStrategyArray = new IStrategy[](1);
        deployedStrategyArray[0] = IStrategy(strategy);
        uint256 numStrategies = deployedStrategyArray.length;

        IStakeRegistryTypes.StakeType[] memory stake_type = new IStakeRegistryTypes.StakeType[](1);
        stake_type[0] = IStakeRegistryTypes.StakeType.TOTAL_SLASHABLE;
        uint32[] memory look_ahead_period = new uint32[](1);
        look_ahead_period[0] = 0;
        bytes memory upgradeCall = abi.encodeCall(
            SlashingRegistryCoordinator.initialize,
            (admin, admin, admin, 0, result.serviceManager)
        );

        UpgradeableProxyLib.upgrade(result.stakeRegistry, stakeRegistryImpl);
        UpgradeableProxyLib.upgrade(result.blsapkRegistry, blsApkRegistryImpl);
        UpgradeableProxyLib.upgrade(result.indexRegistry, indexRegistryimpl);
        UpgradeableProxyLib.upgradeAndCall(
            result.slashingRegistryCoordinator, slashingRegistryCoordinatorImpl, upgradeCall
        );

        ReclaimServiceManager serviceManagerImpl = new ReclaimServiceManager(
            (IAVSDirectory(avsdirectory)),
            ISlashingRegistryCoordinator(result.slashingRegistryCoordinator),
            IStakeRegistry(result.stakeRegistry),
            core.rewardsCoordinator,
            IAllocationManager(core.allocationManager),
            IPermissionController(core.permissionController),
            IReclaimTaskManager(result.taskManager)
        );

        ReclaimTaskManager taskManagerImpl = new ReclaimTaskManager(
            IStakeRegistry(result.stakeRegistry),
            IRewardsCoordinator(core.rewardsCoordinator),
            IPauserRegistry(address(pausercontract))
        );
        bytes memory servicemanagerupgradecall =
            abi.encodeCall(ReclaimServiceManager.initialize, (admin, admin));
        UpgradeableProxyLib.upgradeAndCall(
            result.serviceManager,
            address(serviceManagerImpl),
            servicemanagerupgradecall
        );

        bytes memory taskmanagerupgradecall = abi.encodeCall(
            ReclaimTaskManager.initialize,
            (admin, address(0))
        );
        UpgradeableProxyLib.upgradeAndCall(
            result.taskManager, address(taskManagerImpl), (taskmanagerupgradecall)
        );

        UpgradeableProxyLib.upgrade(result.slasher, instantSlasherImpl);

        address socketRegistryImpl =
            address(new SocketRegistry(ISlashingRegistryCoordinator(result.slashingRegistryCoordinator)));
        UpgradeableProxyLib.upgrade(result.socketRegistry, socketRegistryImpl);

         // create operator set 
        uint256 numQuorums = setupConfig.numQuorums;
        ISlashingRegistryCoordinatorTypes.OperatorSetParam[] memory quorumsOperatorSetParams =
            new ISlashingRegistryCoordinatorTypes.OperatorSetParam[](numQuorums);
        uint256[] memory operator_params = setupConfig.operatorParams;

        for (uint256 i = 0; i < numQuorums; i++) {
            quorumsOperatorSetParams[i] = ISlashingRegistryCoordinatorTypes.OperatorSetParam({
                maxOperatorCount: uint32(operator_params[i]),
                kickBIPsOfOperatorStake: uint16(operator_params[i + 1]),
                kickBIPsOfTotalStake: uint16(operator_params[i + 2])
            });
        }
        // set to 0 for every quorum
        IStakeRegistryTypes.StrategyParams[][] memory quorumsStrategyParams =
            new IStakeRegistryTypes.StrategyParams[][](numQuorums);
        for (uint256 i = 0; i < numQuorums; i++) {
            quorumsStrategyParams[i] = new IStakeRegistryTypes.StrategyParams[](numStrategies);
            for (uint256 j = 0; j < numStrategies; j++) {
                quorumsStrategyParams[i][j] = IStakeRegistryTypes.StrategyParams({
                    strategy: deployedStrategyArray[j],
                    // setting this to 1 ether since the divisor is also 1 ether
                    // therefore this allows an operator to register with even just 1 token
                    // see https://github.com/Layr-Labs/eigenlayer-middleware/blob/m2-mainnet/src/StakeRegistry.sol#L484
                    //    weight += uint96(sharesAmount * strategyAndMultiplier.multiplier / WEIGHTING_DIVISOR);
                    multiplier: 1 ether
                });
            }
        }

        for(uint256 i = 0; i < numQuorums; i++) {
            ISlashingRegistryCoordinator(result.slashingRegistryCoordinator).createTotalDelegatedStakeQuorum(
                quorumsOperatorSetParams[i],
                100,
                quorumsStrategyParams[i]
            );
        }

        verify_deployment(result);

        return result;
    }

    function readDeploymentJson(uint256 chainId) internal returns (DeploymentData memory) {
        return readDeploymentJson("script/deployments/reclaim/", chainId);
    }

    function readSetupConfigJson(string memory directoryPath)
        internal view
        returns (SetupConfig memory)
    {
        string memory fileName = string.concat(directoryPath, ".json");
        require(vm.exists(fileName), "Deployment file does not exist");
        string memory json = vm.readFile(fileName);

        SetupConfig memory data;
        data.numQuorums = json.readUint(".num_quorums");
        data.operatorParams = json.readUintArray(".operator_params");
        data.aggregator_addr = json.readAddress(".aggregator_addr");
        data.contracts_registry_addr = json.readAddress(".contracts_registry_addr");
        data.operator_addr = json.readAddress(".operator_addr");
        data.task_generator_addr = json.readAddress(".task_generator_addr");
        data.operator_2_addr = json.readAddress(".operator_2_addr");
        data.rewardsInitiator = json.readAddress(".rewards_initiator_addr");
        data.rewardsOwner = json.readAddress(".rewards_owner_addr");
        data.rewardsInitiatorKey = json.readUint(".rewards_initiator_key");
        data.rewardsOwnerKey = json.readUint(".rewards_owner_key");
        return data;
    }

    function readDeploymentJson(string memory directoryPath, uint256 chainId)
        internal view
        returns (DeploymentData memory)
    {
        string memory fileName = string.concat(directoryPath, vm.toString(chainId), ".json");

        require(vm.exists(fileName), "Deployment file does not exist");

        string memory json = vm.readFile(fileName);

        DeploymentData memory data;
        data.serviceManager = json.readAddress(".addresses.serviceManager");
        data.taskManager = json.readAddress(".addresses.taskManager");
        data.slashingRegistryCoordinator = json.readAddress(".addresses.registryCoordinator");
        data.operatorStateRetriever = json.readAddress(".addresses.operatorStateRetriever");
        data.stakeRegistry = json.readAddress(".addresses.stakeRegistry");
        data.strategy = json.readAddress(".addresses.strategy");
        data.token = json.readAddress(".addresses.token");
        data.slasher = json.readAddress(".addresses.instantSlasher");
        data.socketRegistry = json.readAddress(".addresses.socketRegistry");

        return data;
    }

    /// write to default output path
    function writeDeploymentJson(DeploymentData memory data) internal {
        writeDeploymentJson("script/deployments/reclaim/", block.chainid, data);
    }

    function writeDeploymentJson(string memory outputPath, uint256 chainId, DeploymentData memory data) internal {
        address proxyAdmin = address(UpgradeableProxyLib.getProxyAdmin(data.serviceManager));

        string memory deploymentData = _generateDeploymentJson(data, proxyAdmin);

        string memory fileName = string.concat(outputPath, vm.toString(chainId), ".json");
        if (!vm.exists(outputPath)) {
            vm.createDir(outputPath, true);
        }

        vm.writeFile(fileName, deploymentData);
        console2.log("Deployment artifacts written to:", fileName);
    }

    function _generateDeploymentJson(DeploymentData memory data, address proxyAdmin)
        private
        view
        returns (string memory)
    {
        return string.concat(
            '{"lastUpdate":{"timestamp":"',
            vm.toString(block.timestamp),
            '","block_number":"',
            vm.toString(block.number),
            '"},"addresses":',
            _generateContractsJson(data, proxyAdmin),
            "}"
        );
    }

    function _generateContractsJson(DeploymentData memory data, address proxyAdmin)
        private
        view
        returns (string memory)
    {
        return string.concat(
            '{"proxyAdmin":"',
            proxyAdmin.toHexString(),
            '","serviceManager":"',
            data.serviceManager.toHexString(),
            '","serviceManagerImpl":"',
            data.serviceManager.getImplementation().toHexString(),
            '","taskManager":"',
            data.taskManager.toHexString(),
            '","registryCoordinator":"',
            data.slashingRegistryCoordinator.toHexString(),
            '","blsapkRegistry":"',
            data.blsapkRegistry.toHexString(),
            '","indexRegistry":"',
            data.indexRegistry.toHexString(),
            '","stakeRegistry":"',
            data.stakeRegistry.toHexString(),
            '","operatorStateRetriever":"',
            data.operatorStateRetriever.toHexString(),
            '","strategy":"',
            data.strategy.toHexString(),
            '","pauserRegistry":"',
            data.pauserRegistry.toHexString(),
            '","token":"',
            data.token.toHexString(),
            '","instantSlasher":"',
            data.slasher.toHexString(),
            '","socketRegistry":"',
            data.socketRegistry.toHexString(),
            '"}'
        );
    }

    function readCoreDeploymentJson(string memory directoryPath, uint256 chainId)
        internal
        returns (CoreDeploymentLib.DeploymentData memory)
    {
        return readCoreDeploymentJson(directoryPath, string.concat(vm.toString(chainId), ".json"));
    }

    function readCoreDeploymentJson(string memory path, string memory fileName)
        internal
        returns (CoreDeploymentLib.DeploymentData memory)
    {
        string memory pathToFile = string.concat(path, fileName);

        require(vm.exists(pathToFile), "Deployment file does not exist");

        string memory json = vm.readFile(pathToFile);

        CoreDeploymentLib.DeploymentData memory data;
        data.strategyFactory = json.readAddress(".addresses.strategyFactory");
        data.strategyManager = json.readAddress(".addresses.strategyManager");
        data.eigenPodManager = json.readAddress(".addresses.eigenPodManager");
        data.delegationManager = json.readAddress(".addresses.delegation");
        data.avsDirectory = json.readAddress(".addresses.avsDirectory");
        data.pauserRegistry = json.readAddress(".addresses.pauserRegistry");

        return data;
    }

    function verify_deployment(DeploymentData memory result) internal view {
        IBLSApkRegistry blsapkregistry =
            ISlashingRegistryCoordinator(result.slashingRegistryCoordinator).blsApkRegistry();
        require(address(blsapkregistry) != address(0));
        IStakeRegistry stakeregistry = ISlashingRegistryCoordinator(result.slashingRegistryCoordinator).stakeRegistry();
        require(address(stakeregistry) != address(0));
        IDelegationManager delegationmanager = IStakeRegistry(address(stakeregistry)).delegation();
        require(address(delegationmanager) != address(0));
    }
}