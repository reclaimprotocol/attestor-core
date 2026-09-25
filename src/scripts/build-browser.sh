set -e
cp -r node_modules/@reclaimprotocol/zk-symmetric-crypto/resources/ ./browser/resources
cp node_modules/snarkjs/build/snarkjs.min.js ./browser/resources/snarkjs/snarkjs.min.js
# remove r1cs files, we don't need them in prod
rm -rf ./browser/resources/snarkjs/*/*.r1cs 2>/dev/null || true
# remove gnark libs, they are only for nodejs
rm -rf ./browser/resources/gnark 2>/dev/null || true
# ensure stwo resources exist (s2circuits.js + s2circuits_bg.wasm)
if [ ! -f ./browser/resources/stwo/s2circuits.js ]; then
    echo "Warning: stwo/s2circuits.js not found in resources"
fi
if [ ! -f ./browser/resources/stwo/s2circuits_bg.wasm ]; then
    echo "Warning: stwo/s2circuits_bg.wasm not found in resources"
fi
npm run run:tsc -- src/scripts/build-browser.ts
npm run run:tsc -- src/scripts/build-jsc.ts