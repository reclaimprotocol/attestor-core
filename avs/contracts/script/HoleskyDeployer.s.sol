// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import "@eigenlayer/contracts/permissions/PauserRegistry.sol";
import {IDelegationManager} from "@eigenlayer/contracts/interfaces/IDelegationManager.sol";
import {IAVSDirectory} from "@eigenlayer/contracts/interfaces/IAVSDirectory.sol";
import {IStrategyManager, IStrategy} from "@eigenlayer/contracts/interfaces/IStrategyManager.sol";
import {StrategyBase} from "@eigenlayer/contracts/strategies/StrategyBase.sol";
import {ECDSAStakeRegistry} from "@eigenlayer-middleware/src/unaudited/ECDSAStakeRegistry.sol";
import {Quorum, StrategyParams} from "@eigenlayer-middleware/src/interfaces/IECDSAStakeRegistryEventsAndErrors.sol";
import {ReclaimServiceManager} from "../src/ReclaimServiceManager.sol";
import "@eigenlayer/test/mocks/EmptyContract.sol";
import "../src/ERC20Mock.sol";
import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import "forge-std/console.sol";
import {Utils} from "./utils/Utils.sol";

contract HoleskyDeployer is Script, Utils {
    // ERC20 and Strategy: we need to deploy this erc20, create a strategy for it, and whitelist this strategy in the strategy manager

    ERC20Mock public erc20Mock;
    StrategyBase public erc20MockStrategy;

    // Hello World contracts
    ProxyAdmin public proxyAdmin;
    PauserRegistry public pauserReg;
    
    ECDSAStakeRegistry public stakeRegistryProxy;
    ECDSAStakeRegistry public stakeRegistryImplementation;

    ReclaimServiceManager public serviceManagerProxy;
    ReclaimServiceManager public serviceManagerImplementation;

    string public constant METADATA_URI = "https://raw.githubusercontent.com/reclaimprotocol/attestor-core/main/avs/metadata.json";

    function run() external {
        // Manually pasted addresses of Eigenlayer contracts
        address strategyManagerAddr = 0xdfB5f6CE42aAA7830E94ECFCcAd411beF4d4D5b6;
        address delegationManagerAddr = 0xA44151489861Fe9e3055d95adC98FbD462B948e7;
        address avsDirectoryAddr = 0x055733000064333CaDDbC92763c58BF0192fFeBf;
        address eigenLayerProxyAdminAddr = 0xDB023566064246399b4AE851197a97729C93A6cf;
        address eigenLayerPauserRegAddr = 0x85Ef7299F8311B25642679edBF02B62FA2212F06;
        address baseStrategyImplementationAddr = 0x80528D6e9A2BAbFc766965E0E26d5aB08D9CFaF9;

        IStrategyManager strategyManager = IStrategyManager(strategyManagerAddr);
        IDelegationManager delegationManager = IDelegationManager(delegationManagerAddr);
        IAVSDirectory avsDirectory = IAVSDirectory(avsDirectoryAddr);
        ProxyAdmin eigenLayerProxyAdmin = ProxyAdmin(eigenLayerProxyAdminAddr);
        PauserRegistry eigenLayerPauserReg = PauserRegistry(eigenLayerPauserRegAddr);
        StrategyBase baseStrategyImplementation = StrategyBase(baseStrategyImplementationAddr);

        // Read the "hello_world_avs_holesky_deployment_output" file
        string memory jsonContent = readOutput("hello_world_avs_holesky_deployment_output");
        if(bytes(jsonContent).length > 0) {
            console.log("Upgrading contracts...");
            _upgrade(jsonContent, avsDirectory, delegationManager);
            return;
        }

        address communityMultisig = msg.sender;
        address pauser = msg.sender;

        vm.startBroadcast();
        _deployContracts(
            delegationManager,
            avsDirectory,
            baseStrategyImplementation,
            communityMultisig,
            pauser
        );
        vm.stopBroadcast();
    }

    function _deployContracts(
        IDelegationManager delegationManager,
        IAVSDirectory avsDirectory,
        IStrategy baseStrategyImplementation,
        address communityMultisig,
        address pauser
    ) internal {
        // Deploy proxy admin for ability to upgrade proxy contracts
        proxyAdmin = new ProxyAdmin();

        // Deploy pauser registry
        {
            address[] memory pausers = new address[](2);
            pausers[0] = pauser;
            pausers[1] = communityMultisig;
            pauserReg = new PauserRegistry(
                pausers,
                communityMultisig
            );
        }

        EmptyContract emptyContract = new EmptyContract();

        // First, deploy upgradeable proxy contracts that will point to
        // the implementations.
        serviceManagerProxy = ReclaimServiceManager(
            address(
                new TransparentUpgradeableProxy(
                    address(emptyContract),
                    address(proxyAdmin),
                    ""
                )
            )
        );
        stakeRegistryProxy = ECDSAStakeRegistry(
            address(
                new TransparentUpgradeableProxy(
                    address(emptyContract),
                    address(proxyAdmin),
                    ""
                )
            )
        );

        // Second, deploy the implementation contracts, using the
        // proxy contracts as inputs
        {
            stakeRegistryImplementation = new ECDSAStakeRegistry(
                delegationManager
            );

            proxyAdmin.upgrade(
                TransparentUpgradeableProxy(payable(address(stakeRegistryProxy))),
                address(stakeRegistryImplementation)
            );
        }

        {
            // Create an array with one StrategyParams element
            StrategyParams memory strategyParams = StrategyParams({
                strategy: baseStrategyImplementation,
                multiplier: 10_000
            });

            StrategyParams[] memory quorumsStrategyParams = new StrategyParams[](1);
            quorumsStrategyParams[0] = strategyParams;

            Quorum memory quorum = Quorum(
                quorumsStrategyParams
            );

            // Sort the array (though it has only one element,
            // it's trivially sorted). If the array had more elements,
            // you would need to ensure it is sorted by strategy address

            proxyAdmin.upgradeAndCall(
                TransparentUpgradeableProxy(
                    payable(address(stakeRegistryProxy))
                ),
                address(stakeRegistryImplementation),
                abi.encodeWithSelector(
                    ECDSAStakeRegistry.initialize.selector,
                    address(serviceManagerProxy),
                    1,
                    quorum
                )
            );
        }

        serviceManagerImplementation = new ReclaimServiceManager(
            address(avsDirectory),
            address(stakeRegistryProxy),
            address(delegationManager)
        );
        // Upgrade the proxy contracts to use the correct implementation
        // contracts and initialize them.
        proxyAdmin.upgradeAndCall(
            TransparentUpgradeableProxy(
                payable(address(serviceManagerProxy))
            ),
            address(serviceManagerImplementation),
            abi.encodeWithSelector(
                ReclaimServiceManager.setup.selector,
                msg.sender
            )
        );
        serviceManagerProxy.updateAVSMetadataURI(METADATA_URI);

        // WRITE JSON DATA
        string memory parent_object = "parent object";

        string memory deployed_addresses = "addresses";
        vm.serializeAddress(
            deployed_addresses,
            "HelloWorldServiceManagerProxy",
            address(serviceManagerProxy)
        );
        vm.serializeAddress(
            deployed_addresses,
            "HelloWorldServiceManagerImplementation",
            address(serviceManagerImplementation)
        );
        vm.serializeAddress(
            deployed_addresses,
            "ECDSAStakeRegistry",
            address(stakeRegistryProxy)
        );
        vm.serializeAddress(
            deployed_addresses,
            "ProxyAdmin",
            address(proxyAdmin)
        );
        
        string memory deployed_addresses_output = vm.serializeAddress(
            deployed_addresses,
            "ECDSAStakeRegistryImplementation",
            address(stakeRegistryImplementation)
        );

        // Serialize all the data
        string memory finalJson = vm.serializeString(
            parent_object,
            deployed_addresses,
            deployed_addresses_output
        );

        writeOutput(finalJson, "hello_world_avs_holesky_deployment_output");
    }

    function _upgrade(
        string memory jsonContent,
        IAVSDirectory avsDirectory,
        IDelegationManager delegationManager
    ) internal {        
        // Parse JSON content to extract contract addresses
        address serviceManagerProxyAddr = vm.parseJsonAddress(jsonContent, "$.addresses.HelloWorldServiceManagerProxy");
        address stakeRegistryProxyAddr = vm.parseJsonAddress(jsonContent, "$.addresses.ECDSAStakeRegistry");
        address proxyAdminAddr = vm.parseJsonAddress(jsonContent, "$.addresses.ProxyAdmin");

        // Admin for upgrading the proxies
        ProxyAdmin proxyAdmin = ProxyAdmin(proxyAdminAddr);

        console.log("Proxy Admin Address: ", proxyAdminAddr);
        console.log("Service Manager Proxy Address: ", serviceManagerProxyAddr);
        console.log("Stake Registry Proxy Address: ", stakeRegistryProxyAddr);

        // Upgrade the proxies
        vm.startBroadcast();

        // New implementation addresses (assuming these are the new ones to be upgraded to)
        address newServiceManagerImpl = address(new ReclaimServiceManager(
            address(avsDirectory), // AVS Directory address
            stakeRegistryProxyAddr,
            address(delegationManager)  // Delegation Manager address
        ));

        address newStakeRegistryImpl = address(new ECDSAStakeRegistry(
            // Delegation Manager address
            delegationManager
        ));

        console.log("New Service Manager Implementation Address: ", newServiceManagerImpl);
        console.log("New Stake Registry Implementation Address: ", newStakeRegistryImpl);

        // Upgrade the Service Manager proxy
        proxyAdmin.upgrade(
            TransparentUpgradeableProxy(payable(serviceManagerProxyAddr)),
            newServiceManagerImpl
        );
        
        // Upgrade the Stake Registry proxy
        proxyAdmin.upgrade(
            TransparentUpgradeableProxy(payable(stakeRegistryProxyAddr)),
            newStakeRegistryImpl
        );

        console.log("Contracts successfully upgraded!");

        vm.stopBroadcast();
    }
}
