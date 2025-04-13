export const taskABI = [
	{
	  'inputs': [
			{
		  'internalType': 'address',
		  'name': 'initialOwner',
		  'type': 'address'
			},
			{
		  'internalType': 'address',
		  'name': '_governanceAddress',
		  'type': 'address'
			}
	  ],
	  'stateMutability': 'nonpayable',
	  'type': 'constructor'
	},
	{
	  'inputs': [],
	  'name': 'ECDSAInvalidSignature',
	  'type': 'error'
	},
	{
	  'inputs': [
			{
		  'internalType': 'uint256',
		  'name': 'length',
		  'type': 'uint256'
			}
	  ],
	  'name': 'ECDSAInvalidSignatureLength',
	  'type': 'error'
	},
	{
	  'inputs': [
			{
		  'internalType': 'bytes32',
		  'name': 's',
		  'type': 'bytes32'
			}
	  ],
	  'name': 'ECDSAInvalidSignatureS',
	  'type': 'error'
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
	  'anonymous': false,
	  'inputs': [
			{
		  'components': [
					{
			  'internalType': 'uint32',
			  'name': 'id',
			  'type': 'uint32'
					},
					{
			  'internalType': 'uint32',
			  'name': 'timestampStart',
			  'type': 'uint32'
					},
					{
			  'internalType': 'uint32',
			  'name': 'timestampEnd',
			  'type': 'uint32'
					},
					{
			  'components': [
							{
				  'internalType': 'address',
				  'name': 'addr',
				  'type': 'address'
							},
							{
				  'internalType': 'string',
				  'name': 'host',
				  'type': 'string'
							}
			  ],
			  'internalType': 'struct ReclaimTask.Attestor[]',
			  'name': 'attestors',
			  'type': 'tuple[]'
					}
		  ],
		  'indexed': false,
		  'internalType': 'struct ReclaimTask.Task',
		  'name': 'task',
		  'type': 'tuple'
			}
	  ],
	  'name': 'TaskAdded',
	  'type': 'event'
	},
	{
	  'inputs': [],
	  'name': 'ZERO_ADDRESS',
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
		  'internalType': 'uint32',
		  'name': '',
		  'type': 'uint32'
			}
	  ],
	  'name': 'consensusReached',
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
	  'inputs': [
			{
		  'internalType': 'bytes32',
		  'name': 'seed',
		  'type': 'bytes32'
			},
			{
		  'internalType': 'uint32',
		  'name': 'timestamp',
		  'type': 'uint32'
			}
	  ],
	  'name': 'createNewTaskRequest',
	  'outputs': [
			{
		  'internalType': 'uint32',
		  'name': '',
		  'type': 'uint32'
			},
			{
		  'components': [
					{
			  'internalType': 'address',
			  'name': 'addr',
			  'type': 'address'
					},
					{
			  'internalType': 'string',
			  'name': 'host',
			  'type': 'string'
					}
		  ],
		  'internalType': 'struct ReclaimTask.Attestor[]',
		  'name': '',
		  'type': 'tuple[]'
			}
	  ],
	  'stateMutability': 'nonpayable',
	  'type': 'function'
	},
	{
	  'inputs': [],
	  'name': 'currentTask',
	  'outputs': [
			{
		  'internalType': 'uint32',
		  'name': '',
		  'type': 'uint32'
			}
	  ],
	  'stateMutability': 'view',
	  'type': 'function'
	},
	{
	  'inputs': [
			{
		  'internalType': 'bytes32',
		  'name': 'seed',
		  'type': 'bytes32'
			},
			{
		  'internalType': 'uint32',
		  'name': 'timestamp',
		  'type': 'uint32'
			}
	  ],
	  'name': 'fetchAttestorsForClaim',
	  'outputs': [
			{
		  'components': [
					{
			  'internalType': 'address',
			  'name': 'addr',
			  'type': 'address'
					},
					{
			  'internalType': 'string',
			  'name': 'host',
			  'type': 'string'
					}
		  ],
		  'internalType': 'struct ReclaimTask.Attestor[]',
		  'name': '',
		  'type': 'tuple[]'
			}
	  ],
	  'stateMutability': 'view',
	  'type': 'function'
	},
	{
	  'inputs': [
			{
		  'internalType': 'uint32',
		  'name': 'task',
		  'type': 'uint32'
			}
	  ],
	  'name': 'fetchTask',
	  'outputs': [
			{
		  'components': [
					{
			  'internalType': 'uint32',
			  'name': 'id',
			  'type': 'uint32'
					},
					{
			  'internalType': 'uint32',
			  'name': 'timestampStart',
			  'type': 'uint32'
					},
					{
			  'internalType': 'uint32',
			  'name': 'timestampEnd',
			  'type': 'uint32'
					},
					{
			  'components': [
							{
				  'internalType': 'address',
				  'name': 'addr',
				  'type': 'address'
							},
							{
				  'internalType': 'string',
				  'name': 'host',
				  'type': 'string'
							}
			  ],
			  'internalType': 'struct ReclaimTask.Attestor[]',
			  'name': 'attestors',
			  'type': 'tuple[]'
					}
		  ],
		  'internalType': 'struct ReclaimTask.Task',
		  'name': '',
		  'type': 'tuple'
			}
	  ],
	  'stateMutability': 'view',
	  'type': 'function'
	},
	{
	  'inputs': [],
	  'name': 'governanceAddress',
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
	  'inputs': [],
	  'name': 'renounceOwnership',
	  'outputs': [],
	  'stateMutability': 'nonpayable',
	  'type': 'function'
	},
	{
	  'inputs': [],
	  'name': 'requiredAttestors',
	  'outputs': [
			{
		  'internalType': 'uint8',
		  'name': '',
		  'type': 'uint8'
			}
	  ],
	  'stateMutability': 'view',
	  'type': 'function'
	},
	{
	  'inputs': [
			{
		  'internalType': 'uint8',
		  'name': '_requiredAttestors',
		  'type': 'uint8'
			}
	  ],
	  'name': 'setRequiredAttestors',
	  'outputs': [],
	  'stateMutability': 'nonpayable',
	  'type': 'function'
	},
	{
	  'inputs': [],
	  'name': 'taskDurationS',
	  'outputs': [
			{
		  'internalType': 'uint32',
		  'name': '',
		  'type': 'uint32'
			}
	  ],
	  'stateMutability': 'view',
	  'type': 'function'
	},
	{
	  'inputs': [
			{
		  'internalType': 'uint256',
		  'name': '',
		  'type': 'uint256'
			}
	  ],
	  'name': 'tasks',
	  'outputs': [
			{
		  'internalType': 'uint32',
		  'name': 'id',
		  'type': 'uint32'
			},
			{
		  'internalType': 'uint32',
		  'name': 'timestampStart',
		  'type': 'uint32'
			},
			{
		  'internalType': 'uint32',
		  'name': 'timestampEnd',
		  'type': 'uint32'
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
	  'inputs': [
			{
		  'components': [
					{
			  'components': [
							{
				  'internalType': 'string',
				  'name': 'provider',
				  'type': 'string'
							},
							{
				  'internalType': 'string',
				  'name': 'parameters',
				  'type': 'string'
							},
							{
				  'internalType': 'string',
				  'name': 'context',
				  'type': 'string'
							}
			  ],
			  'internalType': 'struct Claims.ClaimInfo',
			  'name': 'claimInfo',
			  'type': 'tuple'
					},
					{
			  'components': [
							{
				  'components': [
									{
					  'internalType': 'bytes32',
					  'name': 'identifier',
					  'type': 'bytes32'
									},
									{
					  'internalType': 'address',
					  'name': 'owner',
					  'type': 'address'
									},
									{
					  'internalType': 'uint32',
					  'name': 'timestampS',
					  'type': 'uint32'
									},
									{
					  'internalType': 'uint32',
					  'name': 'epoch',
					  'type': 'uint32'
									}
				  ],
				  'internalType': 'struct Claims.CompleteClaimData',
				  'name': 'claim',
				  'type': 'tuple'
							},
							{
				  'internalType': 'bytes[]',
				  'name': 'signatures',
				  'type': 'bytes[]'
							}
			  ],
			  'internalType': 'struct Claims.SignedClaim',
			  'name': 'signedClaim',
			  'type': 'tuple'
					}
		  ],
		  'internalType': 'struct ReclaimTask.Proof[]',
		  'name': 'proofs',
		  'type': 'tuple[]'
			},
			{
		  'internalType': 'uint32',
		  'name': 'taskId',
		  'type': 'uint32'
			}
	  ],
	  'name': 'verifyProofs',
	  'outputs': [
			{
		  'internalType': 'bool',
		  'name': '',
		  'type': 'bool'
			}
	  ],
	  'stateMutability': 'payable',
	  'type': 'function'
	}
]
