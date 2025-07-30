set -e
cp -r node_modules/@reclaimprotocol/zk-symmetric-crypto/resources/ ./browser/resources
cp node_modules/snarkjs/build/snarkjs.min.js ./browser/resources/snarkjs.min.js
# remove r1cs files, we don't need them in prod
rm -r ./browser/resources/snarkjs/*/*.r1cs
# remove gnark libs, they are only for nodejs
rm -r ./browser/resources/gnark
npm run run:tsc -- src/scripts/build-bundle.ts