
export default function regularRegex(pattern: string, flags?: string): RegExp {
	return new RegExp(pattern, flags)
}