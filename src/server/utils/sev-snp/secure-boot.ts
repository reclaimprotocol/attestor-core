import { createHash, createPublicKey,X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'

const MAX_EVENT_LOG = 1024 * 1024
const MAX_EVENTS = 8192
const MAX_DIGESTS = 16
const MAX_VARIABLE_NAME = 2048
const MAX_VARIABLE_DATA = 1024 * 1024

const EV_NO_ACTION = 0x00000003
const EV_SEPARATOR = 0x00000004
const EV_EFI_VARIABLE_DRIVER_CONFIG = 0x80000001
const EV_EFI_ACTION = 0x80000007
const EV_EFI_VARIABLE_AUTHORITY = 0x800000e0

const TPM_ALG_SHA256 = 0x000b
const TPM_ALG_SHA384 = 0x000c

// EFI GUIDs use little-endian encoding for the first three fields.
const EFI_CERT_X509_GUID = 'a159c0a594e4a74a87b5ab155c2bf072'
const EFI_CERT_SHA256_GUID = '2616c4c14c509240aca941f936934328'

const RELEASE_SPKI = Buffer.from(createPublicKey(
	readFileSync('./cert/secure-boot/R.pub.pem')
).export({ type: 'spki', format: 'der' }))

type Bank = 'sha256' | 'sha384'

interface EventDigest {
	alg: number
	value: Buffer
}

interface TcgEvent {
	sequence: number
	pcr: number
	type: number
	digests: EventDigest[]
	data: Buffer
}

interface SignatureDatabase {
	certs: X509Certificate[]
	hashes: Buffer[]
}

export interface SecureBootEventLogResult {
	eventLogBytes: number
	verifiedEvents: number
	postSeparatorUses: number
	releasePublicKeySha256: string
}

class LEReader {
	offset = 0
	readonly data: Buffer
	constructor(data: Buffer) { this.data = data }

	remaining() { return this.data.length - this.offset }
	need(size: number, label: string) {
		if(size < 0 || size > this.remaining()) {
			throw new Error(`TCG event log truncated while reading ${label}`)
		}
	}
	u8(label: string) { this.need(1, label); return this.data[this.offset++] }
	u16(label: string) { this.need(2, label); const v = this.data.readUInt16LE(this.offset); this.offset += 2; return v }
	u32(label: string) { this.need(4, label); const v = this.data.readUInt32LE(this.offset); this.offset += 4; return v }
	u64(label: string) { this.need(8, label); const v = this.data.readBigUInt64LE(this.offset); this.offset += 8; return v }
	bytes(size: number, label: string) {
		this.need(size, label)
		const value = Buffer.from(this.data.subarray(this.offset, this.offset + size))
		this.offset += size
		return value
	}
}

function digestSize(alg: number): number | undefined {
	if(alg === 0x0004) {return 20}
	if(alg === TPM_ALG_SHA256) {return 32}
	if(alg === TPM_ALG_SHA384) {return 48}
	if(alg === 0x000d) {return 64}
	return undefined
}

function parseSpecId(data: Buffer): Map<number, number> {
	const r = new LEReader(data)
	const signature = r.bytes(16, 'Spec ID signature')
	if(!signature.equals(Buffer.from('Spec ID Event03\0', 'ascii'))) {
		throw new Error('TCG event log has an invalid Spec ID signature')
	}
	r.u32('platform class')
	const minor = r.u8('Spec ID minor version')
	const major = r.u8('Spec ID major version')
	r.u8('Spec ID errata')
	r.u8('Spec ID uintn size')
	if(major !== 2 || minor !== 0) {
		throw new Error(`unsupported TCG Spec ID version ${major}.${minor}`)
	}
	const count = r.u32('Spec ID algorithm count')
	if(count === 0 || count > MAX_DIGESTS) {
		throw new Error(`invalid TCG Spec ID algorithm count ${count}`)
	}
	const algorithms = new Map<number, number>()
	for(let i = 0; i < count; i++) {
		const alg = r.u16('Spec ID algorithm')
		const size = r.u16('Spec ID digest size')
		if(size === 0 || size > 128 || algorithms.has(alg)) {
			throw new Error(`invalid TCG digest algorithm 0x${alg.toString(16)}`)
		}
		algorithms.set(alg, size)
	}
	const vendorSize = r.u8('Spec ID vendor size')
	if(r.remaining() !== vendorSize) {
		throw new Error('TCG Spec ID vendor data length mismatch')
	}
	r.bytes(vendorSize, 'Spec ID vendor data')
	return algorithms
}

function parseEventLog(raw: Uint8Array): TcgEvent[] {
	const bytes = Buffer.from(raw)
	if(bytes.length === 0) {throw new Error('Secure Boot attestation carries no event log')}
	if(bytes.length > MAX_EVENT_LOG) {throw new Error(`Secure Boot event log exceeds ${MAX_EVENT_LOG} bytes`)}
	const r = new LEReader(bytes)

	const firstPcr = r.u32('first event PCR')
	const firstType = r.u32('first event type')
	r.bytes(20, 'first event SHA-1 digest')
	const firstSize = r.u32('first event size')
	const firstData = r.bytes(firstSize, 'first event data')
	if(firstPcr > 23 || firstType !== EV_NO_ACTION) {
		throw new Error('Secure Boot requires a TPM 2.0 crypto-agile event log')
	}
	const algorithms = parseSpecId(firstData)

	const events: TcgEvent[] = []
	while(r.remaining() !== 0) {
		if(events.length >= MAX_EVENTS) {throw new Error(`TCG event log exceeds ${MAX_EVENTS} events`)}
		const pcr = r.u32('event PCR')
		if(pcr === 0xffffffff) {break}
		if(pcr > 23) {throw new Error(`TCG event uses invalid PCR ${pcr}`)}
		const type = r.u32('event type')
		const count = r.u32('event digest count')
		if(count === 0 || count > MAX_DIGESTS) {throw new Error(`invalid event digest count ${count}`)}
		const digests: EventDigest[] = []
		const seen = new Set<number>()
		for(let i = 0; i < count; i++) {
			const alg = r.u16('event digest algorithm')
			const size = algorithms.get(alg)
			if(!size || size !== digestSize(alg) || seen.has(alg)) {
				throw new Error(`unsupported or duplicate event digest algorithm 0x${alg.toString(16)}`)
			}
			seen.add(alg)
			digests.push({ alg, value: r.bytes(size, 'event digest') })
		}
		const size = r.u32('event data size')
		if(size > MAX_EVENT_LOG) {throw new Error(`event data is too large: ${size}`)}
		events.push({ sequence: events.length + 1, pcr, type, digests, data: r.bytes(size, 'event data') })
	}
	return events
}

function bankAlgorithm(bank: Bank): { id: number, size: number } {
	return bank === 'sha256'
		? { id: TPM_ALG_SHA256, size: 32 }
		: { id: TPM_ALG_SHA384, size: 48 }
}

function replay(events: TcgEvent[], quotedPcrs: Map<number, Buffer>, bank: Bank): TcgEvent[] {
	const { id, size } = bankAlgorithm(bank)
	const verified: TcgEvent[] = []
	for(const pcr of [4, 7, 11]) {
		const expected = quotedPcrs.get(pcr)
		if(expected?.length !== size) {
			throw new Error(`provider quote missing ${bank} PCR ${pcr}`)
		}
		let value = Buffer.alloc(size)
		let count = 0
		for(const event of events) {
			if(event.pcr !== pcr || event.type === EV_NO_ACTION) {continue}
			const digest = event.digests.find(d => d.alg === id)?.value
			if(!digest) {throw new Error(`PCR ${pcr} event has no ${bank} digest`)}
			value = createHash(bank).update(value).update(digest).digest()
			verified.push(event)
			count++
		}
		if(count === 0 || !value.equals(expected)) {
			throw new Error(`Secure Boot event log does not replay to quoted PCR ${pcr}`)
		}
	}
	return verified.sort((a, b) => a.sequence - b.sequence)
}

function parseVariable(data: Buffer): { name: string, value: Buffer } {
	const r = new LEReader(data)
	r.bytes(16, 'UEFI variable GUID')
	const nameLength = r.u64('UEFI variable name length')
	const dataLength = r.u64('UEFI variable data length')
	if(nameLength > BigInt(MAX_VARIABLE_NAME) || dataLength > BigInt(MAX_VARIABLE_DATA)) {
		throw new Error('UEFI variable exceeds parser limits')
	}
	const nameBytes = Number(nameLength) * 2
	const name = r.bytes(nameBytes, 'UEFI variable name').toString('utf16le')
	const value = r.bytes(Number(dataLength), 'UEFI variable data')
	if(r.remaining() !== 0) {throw new Error(`UEFI variable ${name} has trailing data`)}
	return { name, value }
}

function parseSignatureDatabase(data: Buffer): SignatureDatabase {
	const certs: X509Certificate[] = []
	const hashes: Buffer[] = []
	let offset = 0
	while(offset < data.length) {
		if(data.length - offset < 28) {throw new Error('truncated EFI signature list')}
		const type = data.subarray(offset, offset + 16).toString('hex')
		const listSize = data.readUInt32LE(offset + 16)
		const headerSize = data.readUInt32LE(offset + 20)
		const signatureSize = data.readUInt32LE(offset + 24)
		if(listSize < 28 + headerSize || listSize > data.length - offset || signatureSize <= 16) {
			throw new Error('invalid EFI signature list sizes')
		}
		const start = offset + 28 + headerSize
		const end = offset + listSize
		if((end - start) % signatureSize !== 0) {throw new Error('misaligned EFI signature list')}
		for(let entry = start; entry < end; entry += signatureSize) {
			const value = data.subarray(entry + 16, entry + signatureSize)
			if(type === EFI_CERT_X509_GUID) {certs.push(new X509Certificate(value))}
			else if(type === EFI_CERT_SHA256_GUID && value.length === 32) {hashes.push(Buffer.from(value))}
			else {throw new Error(`unsupported EFI signature type ${type}`)}
		}
		offset = end
	}
	return { certs, hashes }
}

function parseAuthority(data: Buffer): X509Certificate {
	const { value } = parseVariable(data)
	if(value.length <= 16) {throw new Error('EFI variable authority is truncated')}
	return new X509Certificate(value.subarray(16))
}

function certificateUsesReleaseKey(cert: X509Certificate): boolean {
	const spki = Buffer.from(cert.publicKey.export({ type: 'spki', format: 'der' }))
	return spki.equals(RELEASE_SPKI)
}

function dataDigestValid(event: TcgEvent, bank: Bank): boolean {
	const id = bankAlgorithm(bank).id
	const measured = event.digests.find(d => d.alg === id)?.value
	return !!measured && measured.equals(createHash(bank).update(event.data).digest())
}

function verifyAuthorityPolicy(events: TcgEvent[], bank: Bank): number {
	let enabled = false
	let seenSeparator = false
	let seenAuthority = false
	const seenVariables = new Set<string>()
	let pk: SignatureDatabase = { certs: [], hashes: [] }
	let kek: SignatureDatabase = { certs: [], hashes: [] }
	let db: SignatureDatabase = { certs: [], hashes: [] }
	let dbx: SignatureDatabase = { certs: [], hashes: [] }
	const preAuthorities: X509Certificate[] = []
	const postAuthorities: X509Certificate[] = []

	for(const event of events) {
		if(event.pcr !== 7) {continue}
		switch(event.type) {
		case EV_SEPARATOR:
			if(seenSeparator) {throw new Error('duplicate PCR 7 separator')}
			seenSeparator = true
			if(!event.data.equals(Buffer.alloc(4)) || !dataDigestValid(event, bank)) {
				throw new Error('invalid PCR 7 separator')
			}
			break
		case EV_EFI_ACTION: {
			const action = event.data.toString('utf8')
			if(action === 'UEFI Debug Mode') {throw new Error('UEFI debugger was present during boot')}
			if(action !== 'DMA Protection Disabled' || !dataDigestValid(event, bank)) {
				throw new Error(`unexpected PCR 7 EFI action ${JSON.stringify(action)}`)
			}
			break
		}
		case EV_EFI_VARIABLE_DRIVER_CONFIG: {
			const variable = parseVariable(event.data)
			if(seenVariables.has(variable.name)) {throw new Error(`duplicate UEFI variable ${variable.name}`)}
			seenVariables.add(variable.name)
			if(seenSeparator) {throw new Error(`UEFI variable ${variable.name} appears after separator`)}
			if(!dataDigestValid(event, bank)) {throw new Error(`invalid digest for UEFI variable ${variable.name}`)}
			switch(variable.name) {
			case 'SecureBoot':
				if(variable.value.length !== 1) {throw new Error('SecureBoot variable has invalid length')}
				enabled = variable.value[0] === 1
				break
			case 'PK': pk = parseSignatureDatabase(variable.value); break
			case 'KEK': kek = parseSignatureDatabase(variable.value); break
			case 'db': db = parseSignatureDatabase(variable.value); break
			case 'dbx': dbx = parseSignatureDatabase(variable.value); break
			}
			break
		}
		case EV_EFI_VARIABLE_AUTHORITY: {
			const authority = parseAuthority(event.data)
			seenAuthority = true
			if(!dataDigestValid(event, bank)) {throw new Error('invalid digest for UEFI authority')}
			if(seenSeparator) {postAuthorities.push(authority)}
			else {preAuthorities.push(authority)}
			break
		}
		default:
			throw new Error(`unexpected PCR 7 event type 0x${event.type.toString(16)}`)
		}
	}

	if(!enabled) {throw new Error('Secure Boot is not enabled')}
	if(!seenAuthority) {throw new Error('Secure Boot enabled but no key was used')}
	if(pk.certs.length + pk.hashes.length === 0) {throw new Error('Secure Boot platform key is missing')}
	if(kek.certs.length + kek.hashes.length === 0) {throw new Error('Secure Boot key exchange key is missing')}
	if(db.certs.length !== 1 || db.hashes.length !== 0 || !certificateUsesReleaseKey(db.certs[0])) {
		throw new Error('Secure Boot db is not R-only')
	}
	if(dbx.certs.some(certificateUsesReleaseKey)) {throw new Error('Secure Boot release key R is forbidden by dbx')}
	if(preAuthorities.length !== 0) {throw new Error('Secure Boot used a pre-separator authority')}
	if(postAuthorities.length === 0 || !postAuthorities.every(certificateUsesReleaseKey)) {
		throw new Error('not every post-separator Secure Boot authority is R')
	}
	return postAuthorities.length
}

export function verifySecureBootEventLog(
	raw: Uint8Array,
	quotedPcrs: Map<number, Buffer>,
	bank: Bank
): SecureBootEventLogResult {
	const events = parseEventLog(raw)
	const verified = replay(events, quotedPcrs, bank)
	const postSeparatorUses = verifyAuthorityPolicy(verified, bank)
	return {
		eventLogBytes: raw.length,
		verifiedEvents: verified.length,
		postSeparatorUses,
		releasePublicKeySha256: createHash('sha256').update(RELEASE_SPKI).digest('hex'),
	}
}
