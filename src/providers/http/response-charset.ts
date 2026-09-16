import { Tokenizer, TokenizerMode } from 'parse5'

// Mirrors reclaim-tee's response-local HTML policy. This runs on authenticated,
// dechunked bytes; no charset supplied by a claimant is trusted.
export function detectResponseCharset(body: Uint8Array, contentType?: string) {
	const header = /(?:^|;)\s*charset\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]*))/i.exec(contentType ?? '')
	const headerLabel = (header?.[1]?.replace(/\\(.)/g, '$1') ?? header?.[2])?.trim()
	if(contentType?.split(';', 1)[0].trim().toLowerCase() !== 'text/html') {
		return headerLabel || undefined
	}

	for(const [signature, charset] of [
		[[0xef, 0xbb, 0xbf], 'utf-8'],
		[[0xff, 0xfe], 'utf-16le'],
		[[0xfe, 0xff], 'utf-16be'],
	] as const) {
		if(signature.every((byte, i) => body[i] === byte)) {
			return charset
		}
	}
	const fromHeader = supportedCharset(headerLabel)
	if(fromHeader) {
		return fromHeader
	}
	for(const [signature, charset] of [
		[[0x3c, 0, 0x3f, 0, 0x78, 0], 'utf-16le'],
		[[0, 0x3c, 0, 0x3f, 0, 0x78], 'utf-16be'],
	] as const) {
		if(signature.every((byte, i) => body[i] === byte)) {
			return charset
		}
	}

	// Only ASCII markup is inspected here. Latin-1 keeps one character per
	// original byte; actual body decoding happens after charset selection.
	let raw = ''
	for(let i = 0; i < body.length; i += 8192) {
		raw += String.fromCharCode(...body.subarray(i, i + 8192))
	}
	const fromMeta = scanMeta(raw)
	if(fromMeta) {
		return fromMeta
	}
	const fromXml = scanXml(raw)
	if(fromXml) {
		return fromXml
	}
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(body)
		return 'utf-8'
	} catch {
		throw new Error('Cannot determine HTML response charset: no supported declaration and body is not valid UTF-8')
	}
}

function supportedCharset(label?: string) {
	if(!label) {
		return undefined
	}
	// WHATWG meta declarations map this legacy label to Windows-1252.
	if(label.trim().toLowerCase() === 'x-user-defined') {
		return 'x-user-defined'
	}
	try {
		return new TextDecoder(label).encoding
	} catch {
		return undefined
	}
}

function metaContentCharset(content: string) {
	const text = content.toLowerCase()
	let offset = 0
	while(offset < text.length) {
		const start = text.indexOf('charset', offset)
		if(start < 0) {
			break
		}
		offset = start + 7
		while(' \t\n\f\r'.includes(text[offset] ?? '\0')) {
			offset++
		}
		if(text[offset++] !== '=') {
			continue
		}
		while(' \t\n\f\r'.includes(text[offset] ?? '\0')) {
			offset++
		}
		const quote = text[offset]
		if(quote === '"' || quote === "'") {
			const end = text.indexOf(quote, offset + 1)
			return end < 0 ? undefined : text.slice(offset + 1, end)
		}
		let end = offset
		while(end < text.length && !'; \t\n\f\r'.includes(text[end])) {
			end++
		}
		return text.slice(offset, end)
	}
	return undefined
}

function scanMeta(raw: string) {
	let charset: string | undefined
	const noop = () => {}
	const tokenizer = new Tokenizer({}, {
		onComment: noop, onDoctype: noop, onEndTag: noop, onEof: noop,
		onCharacter: noop, onNullCharacter: noop, onWhitespaceCharacter: noop,
		onStartTag(token) {
			// A tokenizer without a tree builder must enter raw-text modes
			// explicitly, otherwise script literals become markup.
			if(token.tagName === 'script') {
				tokenizer.state = TokenizerMode.SCRIPT_DATA
			} else if(['title', 'textarea'].includes(token.tagName)) {
				tokenizer.state = TokenizerMode.RCDATA
			} else if(['style', 'xmp', 'iframe', 'noembed', 'noframes'].includes(token.tagName)) {
				tokenizer.state = TokenizerMode.RAWTEXT
			} else if(token.tagName === 'plaintext') {
				tokenizer.state = TokenizerMode.PLAINTEXT
			}
			if(charset || token.tagName !== 'meta') {
				return
			}
			const attrs = new Map(token.attrs.map(attr => [attr.name, attr.value]))
			const label = attrs.has('charset') ? attrs.get('charset')
				: attrs.get('http-equiv')?.toLowerCase() === 'content-type'
					? metaContentCharset(attrs.get('content') ?? '') : undefined
			charset = supportedCharset(label)
			if(charset?.startsWith('utf-16')) {
				charset = 'utf-8'
			} else if(charset === 'x-user-defined') {
				charset = 'windows-1252'
			}
		},
	})
	tokenizer.write(raw, true)
	return charset
}

function scanXml(raw: string) {
	const space = (value: string | undefined) => value !== undefined && ' \t\r\n'.includes(value)
	if(!raw.startsWith('<?xml') || !space(raw[5])) {
		return undefined
	}
	let pos = 5
	let label: string | undefined
	const seen = new Set<string>()
	const skipSpace = () => {
		while(space(raw[pos])) {
			pos++
		}
	}
	while(pos < raw.length) {
		skipSpace()
		if(raw.startsWith('?>', pos)) {
			const charset = supportedCharset(label)
			return charset?.startsWith('utf-16') ? 'utf-8' : charset
		}
		const start = pos
		while(pos < raw.length && raw[pos] >= 'a' && raw[pos] <= 'z') {
			pos++
		}
		const key = raw.slice(start, pos)
		if(!['version', 'encoding', 'standalone'].includes(key) || seen.has(key)) {
			return undefined
		}
		seen.add(key)
		skipSpace()
		if(raw[pos++] !== '=') {
			return undefined
		}
		skipSpace()
		const quote = raw[pos++]
		if(quote !== '"' && quote !== "'") {
			return undefined
		}
		const end = raw.indexOf(quote, pos)
		if(end < 0) {
			return undefined
		}
		const value = raw.slice(pos, end)
		pos = end + 1
		if(key === 'version' && !['1.0', '1.1'].includes(value)
			|| key === 'standalone' && !['yes', 'no'].includes(value)) {
			return undefined
		}
		if(key === 'encoding') {
			if([...value].some(char => char.charCodeAt(0) <= 0x20)) {
				return undefined
			}
			label = value
		}
		if(!raw.startsWith('?>', pos) && !space(raw[pos])) {
			return undefined
		}
	}
	return undefined
}
