# SEV-SNP attestation protos (go-tpm-tools/go-sev-guest/go-tdx-guest/etc).
# Separate from generate-proto.sh: needs forceLong=bigint (SEV report uint64
# TCB/policy fields exceed 2^53 and must not be lossy), and pulls in the
# google/protobuf well-known types these protos import.
WK="$(dirname "$(command -v protoc)")/../include"
protoc --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
	--ts_proto_out=./src/proto \
	--ts_proto_opt=enumsAsLiterals=true,useExactTypes=false,forceLong=bigint,importSuffix=.ts \
	--proto_path=./proto-sevsnp --proto_path="$WK" \
	./proto-sevsnp/*.proto "$WK/google/protobuf/wrappers.proto"
