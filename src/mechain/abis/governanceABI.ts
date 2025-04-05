export const governanceABI = [
	{
		'inputs': [
			{
				'internalType': 'address',
				'name': 'initialOwner',
				'type': 'address'
			},
			{
				'internalType': 'uint256',
				'name': '_minimumStake',
				'type': 'uint256'
			},
			{
				'internalType': 'uint256',
				'name': '_unbondingPeriod',
				'type': 'uint256'
			}
		],
		'stateMutability': 'nonpayable',
		'type': 'constructor'
	},
	{
		'inputs': [
			{
				'internalType': 'address',
				'name': 'owner',
				'type': 'address'
			}
		],
		'name': 'OwnableInvalidOwner',
		'type': 'error'
	},
	{
		'inputs': [
			{
				'internalType': 'address',
				'name': 'account',
				'type': 'address'
			}
		],
		'name': 'OwnableUnauthorizedAccount',
		'type': 'error'
	},
	{
		'anonymous': false,
		'inputs': [
			{
				'indexed': true,
				'internalType': 'address',
				'name': 'previousOwner',
				'type': 'address'
			},
			{
				'indexed': true,
				'internalType': 'address',
				'name': 'newOwner',
				'type': 'address'
			}
		],
		'name': 'OwnershipTransferred',
		'type': 'event'
	},
	{
		'inputs': [
			{
				'internalType': 'string',
				'name': '',
				'type': 'string'
			}
		],
		'name': 'Attestors',
		'outputs': [
			{
				'internalType': 'address',
				'name': '',
				'type': 'address'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'string',
				'name': '_key',
				'type': 'string'
			},
			{
				'internalType': 'address',
				'name': '_address',
				'type': 'address'
			}
		],
		'name': 'addAttestor',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'claimRewards',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'string',
				'name': '_key',
				'type': 'string'
			}
		],
		'name': 'getAttestor',
		'outputs': [
			{
				'internalType': 'address',
				'name': '',
				'type': 'address'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'getAttestors',
		'outputs': [
			{
				'internalType': 'string[]',
				'name': 'keys',
				'type': 'string[]'
			},
			{
				'internalType': 'address[]',
				'name': 'addresses',
				'type': 'address[]'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'minimumStake',
		'outputs': [
			{
				'internalType': 'uint256',
				'name': '',
				'type': 'uint256'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'owner',
		'outputs': [
			{
				'internalType': 'address',
				'name': '',
				'type': 'address'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'address',
				'name': '',
				'type': 'address'
			}
		],
		'name': 'pendingRewards',
		'outputs': [
			{
				'internalType': 'uint256',
				'name': '',
				'type': 'uint256'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'reclaimContractAddress',
		'outputs': [
			{
				'internalType': 'address',
				'name': '',
				'type': 'address'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'address[]',
				'name': '_attestorAddresses',
				'type': 'address[]'
			}
		],
		'name': 'registerRewards',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'string',
				'name': '_key',
				'type': 'string'
			}
		],
		'name': 'removeAttestor',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'renounceOwnership',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'requestUnstake',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'uint256',
				'name': '_minimumStake',
				'type': 'uint256'
			}
		],
		'name': 'setMinimumStake',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'address',
				'name': '_reclaimContractAddress',
				'type': 'address'
			}
		],
		'name': 'setReclaimContractAddress',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'bool',
				'name': '_slashingEnabled',
				'type': 'bool'
			}
		],
		'name': 'setSlashingEnabled',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'uint256',
				'name': '_unbondingPeriod',
				'type': 'uint256'
			}
		],
		'name': 'setUnbondingPeriod',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'uint256',
				'name': '_verificationCost',
				'type': 'uint256'
			}
		],
		'name': 'setVerificationCost',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'uint256',
				'name': '_amount',
				'type': 'uint256'
			}
		],
		'name': 'slash',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'slashingEnabled',
		'outputs': [
			{
				'internalType': 'bool',
				'name': '',
				'type': 'bool'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'stake',
		'outputs': [],
		'stateMutability': 'payable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'address',
				'name': '',
				'type': 'address'
			}
		],
		'name': 'stakedAmounts',
		'outputs': [
			{
				'internalType': 'uint256',
				'name': '',
				'type': 'uint256'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'totalSlashedAmount',
		'outputs': [
			{
				'internalType': 'uint256',
				'name': '',
				'type': 'uint256'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'totalStaked',
		'outputs': [
			{
				'internalType': 'uint256',
				'name': '',
				'type': 'uint256'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'address',
				'name': 'newOwner',
				'type': 'address'
			}
		],
		'name': 'transferOwnership',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'unbondingPeriod',
		'outputs': [
			{
				'internalType': 'uint256',
				'name': '',
				'type': 'uint256'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'unstake',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	},
	{
		'inputs': [
			{
				'internalType': 'address',
				'name': '',
				'type': 'address'
			}
		],
		'name': 'unstakeRequestBlocks',
		'outputs': [
			{
				'internalType': 'uint256',
				'name': '',
				'type': 'uint256'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'verificationCost',
		'outputs': [
			{
				'internalType': 'uint256',
				'name': '',
				'type': 'uint256'
			}
		],
		'stateMutability': 'view',
		'type': 'function'
	},
	{
		'inputs': [],
		'name': 'withdraw',
		'outputs': [],
		'stateMutability': 'nonpayable',
		'type': 'function'
	}
]
