mkdir -p src/proto

# Base attestor protos.
protoc --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
	--ts_proto_out=./src/proto \
	--ts_proto_opt=enumsAsLiterals=true,useExactTypes=false \
	--proto_path=./proto ./proto/*.proto

# SEV-SNP attestation protos (go-tpm-tools/go-sev-guest/go-tdx-guest/etc) in
# proto/snp: need forceLong=bigint (SEV report uint64 TCB/policy fields exceed
# 2^53 and must not be lossy) + the google/protobuf well-known types they import.
WK="$(dirname "$(command -v protoc)")/../include"
protoc --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
	--ts_proto_out=./src/proto \
	--ts_proto_opt=enumsAsLiterals=true,useExactTypes=false,forceLong=bigint,importSuffix=.ts \
	--proto_path=./proto/snp --proto_path="$WK" \
	./proto/snp/*.proto "$WK/google/protobuf/wrappers.proto"
