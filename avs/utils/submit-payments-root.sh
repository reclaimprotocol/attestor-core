set -e
cd avs/contracts

echo "submitting payments root: $OPERATOR_ADDRESS $END_TIMESTAMP $PAYMENT"

forge script script/SetupPayments.s.sol \
	--rpc-url http://localhost:8545 \
	--broadcast -v --via-ir \
	--revert-strings debug \
	--sender 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 \
	--sig "runPaymentRoot(address[], uint32, uint32, uint32)" \
	"[$OPERATOR_ADDRESS]" \
  	$END_TIMESTAMP 1 $PAYMENT
# forge script script/SetupPayments.s.sol \
# 	--rpc-url http://localhost:8545 \
# 	--broadcast -v --via-ir \
# 	--revert-strings debug \
# 	--sender 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 \
# 	--sig "executeProcessClaim(address)" \
# 	'0x1234567890123456789012345678901234567890'