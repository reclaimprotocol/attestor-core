import assert from 'node:assert'
import { createHash,X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { verifySecureBootEventLog } from '#src/server/utils/sev-snp/secure-boot.ts'

const R_CERT = Buffer.from(new X509Certificate(
	readFileSync('./cert/secure-boot/R.crt.pem')
).raw)
const OTHER_CERT = Buffer.from(new X509Certificate(
	readFileSync('./cert/sev-snp/gcp_vtpm_ca_root.crt')
).raw)

function le32(value: number) {
	const b = Buffer.alloc(4); b.writeUInt32LE(value); return b
}

function le64(value: number) {
	const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b
}

function variable(name: string, value: Buffer): Buffer {
	const encodedName = Buffer.from(name, 'utf16le')
	return Buffer.concat([
		Buffer.alloc(16),
		le64(name.length),
		le64(value.length),
		encodedName,
		value,
	])
}

function x509SignatureList(cert: Buffer): Buffer {
	const x509Guid = Buffer.from('a159c0a594e4a74a87b5ab155c2bf072', 'hex')
	const signatureSize = 16 + cert.length
	return Buffer.concat([
		x509Guid,
		le32(28 + signatureSize),
		le32(0),
		le32(signatureSize),
		Buffer.alloc(16),
		cert,
	])
}

interface EventInput { pcr: number, type: number, data: Buffer }

function encodeEvent(event: EventInput): Buffer {
	const sha256 = createHash('sha256').update(event.data).digest()
	const sha384 = createHash('sha384').update(event.data).digest()
	return Buffer.concat([
		le32(event.pcr), le32(event.type), le32(2),
		Buffer.from([0x0b, 0x00]), sha256,
		Buffer.from([0x0c, 0x00]), sha384,
		le32(event.data.length), event.data,
	])
}

function specIdEvent(): Buffer {
	const data = Buffer.concat([
		Buffer.from('Spec ID Event03\0', 'ascii'),
		le32(0),
		Buffer.from([0, 2, 0, 2]),
		le32(2),
		Buffer.from([0x0b, 0x00, 32, 0]),
		Buffer.from([0x0c, 0x00, 48, 0]),
		Buffer.from([0]),
	])
	return Buffer.concat([
		le32(0), le32(3), Buffer.alloc(20), le32(data.length), data,
	])
}

function buildLog(options: {
	enabled?: boolean
	duplicateDb?: boolean
	preAuthority?: boolean
	foreignAuthority?: boolean
} = {}) {
	const esl = x509SignatureList(R_CERT)
	const db = options.duplicateDb ? Buffer.concat([esl, esl]) : esl
	const events: EventInput[] = [
		{ pcr: 7, type: 0x80000001, data: variable('SecureBoot', Buffer.from([options.enabled === false ? 0 : 1])) },
		{ pcr: 7, type: 0x80000001, data: variable('PK', esl) },
		{ pcr: 7, type: 0x80000001, data: variable('KEK', esl) },
		{ pcr: 7, type: 0x80000001, data: variable('db', db) },
	]
	if(options.preAuthority) {
		events.push({ pcr: 7, type: 0x800000e0, data: variable('db', Buffer.concat([Buffer.alloc(16), R_CERT])) })
	}
	events.push(
		{ pcr: 7, type: 0x00000004, data: Buffer.alloc(4) },
		{
			pcr: 7,
			type: 0x800000e0,
			data: variable('db', Buffer.concat([Buffer.alloc(16), options.foreignAuthority ? OTHER_CERT : R_CERT])),
		},
		{ pcr: 4, type: 0x80000003, data: Buffer.from('R-signed UKI') },
		{ pcr: 11, type: 0x0000000d, data: Buffer.from('UKI section measurements') },
	)
	const pcrs = (bank: 'sha256' | 'sha384') => {
		const size = bank === 'sha256' ? 32 : 48
		const result = new Map<number, Buffer>()
		for(const pcr of [4, 7, 11]) {
			let value = Buffer.alloc(size)
			for(const event of events.filter(e => e.pcr === pcr)) {
				const digest = createHash(bank).update(event.data).digest()
				value = createHash(bank).update(value).update(digest).digest()
			}
			result.set(pcr, value)
		}
		return result
	}
	return {
		raw: Buffer.concat([specIdEvent(), ...events.map(encodeEvent)]),
		sha256Pcrs: pcrs('sha256'),
		sha384Pcrs: pcrs('sha384'),
	}
}

test('Secure Boot event log verifies for both cloud PCR banks', () => {
	const fixture = buildLog()
	for(const [bank, pcrs] of [
		['sha256', fixture.sha256Pcrs],
		['sha384', fixture.sha384Pcrs],
	] as const) {
		const result = verifySecureBootEventLog(fixture.raw, pcrs, bank)
		assert.equal(result.postSeparatorUses, 1)
		assert.equal(result.eventLogBytes, fixture.raw.length)
	}
})

test('Secure Boot event log rejects a quoted-PCR mismatch', () => {
	const fixture = buildLog()
	fixture.sha256Pcrs.set(7, Buffer.alloc(32, 0xff))
	assert.throws(
		() => verifySecureBootEventLog(fixture.raw, fixture.sha256Pcrs, 'sha256'),
		/does not replay/
	)
})

test('Secure Boot event log rejects disabled Secure Boot and an extra db key', () => {
	for(const fixture of [buildLog({ enabled: false }), buildLog({ duplicateDb: true })]) {
		assert.throws(() => verifySecureBootEventLog(fixture.raw, fixture.sha256Pcrs, 'sha256'))
	}
})

test('Secure Boot event log rejects pre-separator and foreign authorities', () => {
	for(const fixture of [buildLog({ preAuthority: true }), buildLog({ foreignAuthority: true })]) {
		assert.throws(() => verifySecureBootEventLog(fixture.raw, fixture.sha256Pcrs, 'sha256'))
	}
})
