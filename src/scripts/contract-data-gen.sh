rm -rf src/contracts
rm -rf src/types/contracts
mkdir -p src/contracts
cp -r ../resources/contracts/config.json ./src/contracts/
yarn typechain --target=ethers-v5 --out-dir src/types/contracts '../resources/contracts/abi/*.json'