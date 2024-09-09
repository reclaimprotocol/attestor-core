# AVS

We use Eigen's AVS to decentralize the validation of reclaim data.
AVS stands for Actively Validated Service. You can read more about it [here](https://docs.eigenlayer.xyz/eigenlayer/avs-guides/avs-developer-guide).

## Stack

The AVS is built on the stack Eigen provides in their [Hello world AVS](https://github.com/Layr-Labs/hello-world-avs)

1. [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
2. [Foundry](https://getfoundry.sh/)
3. [Docker](https://www.docker.com/get-started/)
    3.1 Make sure Docker is running

## Operating a Node on the Reclaim AVS

Presently, the AVS is only available on the Holesky testnet & only whitelisted nodes can participate in the AVS. If you're interested in participating, please reach out to us [here](TODO).

Regardless, if you're one of the chosen few -- here's how you can register yourself on the AVS:

1. Clone the repository
2. Run `npm install`
3. Setup the environment variables in a `.env` file. Refer to our [environment variables guide](./env.md) for more information.
	- Ensure that the address of the private key you're using is whitelisted on the AVS
	- Also ensure there's enough ETH in the account to pay for gas & staking
	- Set the `CHAIN_ID` to `0x539` for holesky
4. Run `npm run register-avs-operator`
	- Note: if your env is setup with a `.production` suffix, you'll need to run the above command with the `NODE_ENV=production` env flag.
	- Also, if you're already registered -- this command will update your metadata on the AVS.
5. If all goes well, you should be successfully registered on the AVS.
6. Check your registration status by running `npm run check-avs-registration`.
	- (this'll access the config from the environment variables)
7. Whenever you run the Reclaim operator now (using `npm run start`), users will be able to discover your node & generate proofs.

## Working on the AVS

1. Clone the repository
2. Run `npm install`
3. Install the submodules with `git submodule update --init --recursive`
	- this'll enable you to work on the contracts
4. Run `npm run start-chain` to start the local chain with the contracts already deployed

**Building the contracts**:
	- `npm run build-contracts`
**Deploying the contracts locally**:
	- `npm run deploy-contracts`
	- This will deploy the contracts on the local anvil network, and save the state of the contracts.

**Testing**:
	- `npm run test` to run all the tests
	- `npm run test-avs` to run the AVS tests