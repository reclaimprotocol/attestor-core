
export default function regularRegex(pattern: string, flags?: string): RegExp {
	flags = flags?.replace('u', '') // remove unicode flag if present
	return new RegExp(pattern, flags)
}