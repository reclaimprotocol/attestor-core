import { spawn } from 'child_process'
import { BigNumberish } from 'ethers'

export async function runFreshChain() {
	const PRIVATE_KEY = process.env.PRIVATE_KEY
	if(!PRIVATE_KEY) {
		throw new Error('PRIVATE_KEY environment variable is required')
	}

	const task = spawn(
		'npm',
		['run', 'start:chain'],
		{ env: process.env }
	)
	task.stderr.pipe(process.stderr)
	await new Promise<void>((resolve, reject) => {
		task.stdout.on('data', (data) => {
			if(data.toString().includes('Deployed Reclaim contracts')) {
				resolve()
			}
		})
		task.on('exit', (code) => {
			reject(`Exited with code ${code || 0}`)
		})
	})

	console.log('Anvil chain booted')

	return async() => {
		process.kill(task.pid!, 'SIGTERM')
		await new Promise<void>((resolve) => {
			task.on('exit', resolve)
		})

		console.log('Chain shutdown')
	}
}

export function submitPaymentRoot(
	operator: string,
	endTimestampS: number,
	payment: number | BigNumberish
) {
	return spawnAndWait('npm', ['run', 'submit:payments-root'], {
		env: {
			...process.env,
			OPERATOR_ADDRESS: operator,
			END_TIMESTAMP: endTimestampS.toString(),
			PAYMENT: payment.toString()
		},
	})
}

export function sendGasToAddress(address: string) {
	return spawnAndWait(
		'cast',
		[
			'send',
			address,
			'--value',
			'10ether',
			'--private-key',
			'0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6'
		],
		{}
	)
}

function spawnAndWait(...args: Parameters<typeof spawn>) {
	const task = spawn(...args)
	task.stdout?.pipe(process.stdout)
	task.stderr?.pipe(process.stderr)

	return new Promise<void>((resolve, reject) => {
		task.on('exit', (code) => {
			if(code === 0) {
				resolve()
			} else {
				reject(`${args[0]} process exited with code ${code || 0}`)
			}
		})
	})
}