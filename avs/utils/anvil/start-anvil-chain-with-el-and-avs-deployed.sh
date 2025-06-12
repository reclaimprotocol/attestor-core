#!/bin/bash

RPC_URL=http://localhost:8545

# cd to the directory of this script so that this can be run from anywhere
parent_path=$(
    cd "$(dirname "${BASH_SOURCE[0]}")"
    pwd -P
)
cd "$parent_path"

cleanup() {
    echo "Executing cleanup function..."
    set +e
    docker rm -f anvil
    exit_status=$?
    if [ $exit_status -ne 0 ]; then
        echo "Script exited due to set -e on line $1 with command '$2'. Exit status: $exit_status"
    fi
}
trap 'cleanup $LINENO "$BASH_COMMAND"' EXIT

set -e

docker run --rm -d --name anvil -p 8545:8545 \
	--entrypoint anvil \
	--env ANVIL_IP_ADDR=0.0.0.0 \
	ghcr.io/foundry-rs/foundry:v1.2.2

echo "Waiting for Anvil to start..."
sleep 2

cd ../../contracts/lib/eigenlayer-middleware/lib/eigenlayer-contracts
forge script script/deploy/devnet/deploy_from_scratch.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key $PRIVATE_KEY \
  --sig "run(string memory configFile)" \
  -- local/deploy_from_scratch.slashing.anvil.config.json
echo "Deployed Eigen Core contracts"

npm run deploy:reclaim-debug
echo "Deployed Reclaim contracts"

# Bring Anvil back to the foreground
docker attach anvil