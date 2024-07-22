cp -r node_modules/@reclaimprotocol/circom-symmetric-crypto/resources/ ./browser/resources
cp  ./jsdom.js ./browser/resources/jsdom.js
# remove r1cs files, we don't need them in prod
rm -r ./browser/resources/*/*.r1cs
# remove gnark libs, they are only for nodejs
rm -r ./browser/resources/gnark
npm exec webpack