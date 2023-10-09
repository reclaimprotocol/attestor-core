cp -r node_modules/@reclaimprotocol/circom-symmetric-crypto/resources/ ./browser/resources
# remove r1cs files, we don't need them in prod
rm -r ./browser/resources/*/*.r1cs
npm exec webpack