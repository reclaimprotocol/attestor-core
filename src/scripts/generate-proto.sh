mkdir -p src/proto
protoc --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
	--ts_proto_out=./src/proto \
	--ts_proto_opt=enumsAsLiterals=true,useExactTypes=false \
	--proto_path=./proto ./proto/*.proto

node src/scripts/remove-namespaces.js