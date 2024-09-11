import { spawn } from 'child_process'

export async function runFreshChain() {
	const task = spawn('npm', ['run', 'start:chain'])
	task.stderr.pipe(process.stderr)
	await new Promise<void>((resolve, reject) => {
		task.stdout.on('data', (data) => {
			if(data.toString().includes('advancing chain...')) {
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

export async function sendGasToAddress(address: string) {
	const task = spawn('cast', [
		'send',
		address,
		'--value',
		'10ether',
		'--private-key',
		'0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6'
	])

	task.stdout.pipe(process.stdout)
	task.stderr.pipe(process.stderr)

	await new Promise<void>((resolve, reject) => {
		task.on('exit', (code) => {
			if(code === 0) {
				resolve()
			} else {
				reject(`Gas add process exited with code ${code || 0}`)
			}
		})
	})
}