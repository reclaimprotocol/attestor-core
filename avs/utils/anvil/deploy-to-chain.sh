#!/bin/bash
set -e

# Load environment variables from production file
export $(grep -v '^#' .env.production | xargs)
# Deploy to chain
cd avs/contracts
forge script script/HoleskyDeployer.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast -v