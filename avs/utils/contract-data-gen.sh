rm -rf src/avs/contracts
mkdir -p src/avs/contracts
typechain -- --target ethers-v5 --out-dir src/avs/contracts \
	avs/contracts/out/ReclaimServiceManager.sol/*.json \
	avs/contracts/out/ReclaimTaskManager.sol/*.json \
	avs/contracts/out/ReclaimSlashingRegistryCoordinator.sol/*.json \
	avs/contracts/out/AVSDirectory.sol/*.json \
	avs/contracts/out/DelegationManager.sol/*.json \
	avs/contracts/out/ECDSAStakeRegistry.sol/*.json \
	avs/contracts/out/ERC20Mock.sol/*.json \
	avs/contracts/out/RewardsCoordinator.sol/*.json \
	avs/contracts/out/SocketRegistry.sol/*.json \