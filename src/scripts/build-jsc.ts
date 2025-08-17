import * as esbuild from 'esbuild'

// are we building for the CLI (used for testing)?
const isCliBuild = process.argv.includes('--cli')
if(isCliBuild) {
	console.log('Building for CLI...')
}

const rslt = await esbuild.build({
	bundle: true,
	...(
		isCliBuild
			? {
				entryPoints: ['src/scripts/jsc-cli-rpc.ts'],
				outfile: 'out/jsc-cli-rpc.mjs'
			}
			: {
				minify: true,
				entryPoints: ['src/external-rpc/setup-jsc.ts'],
				outfile: 'browser/resources/attestor-jsc.min.mjs'
			}
	),
	format: isCliBuild ? 'esm' : 'iife',
	tsconfig: 'tsconfig.build.json',
	legalComments: 'none',
	metafile: true, // Enable metafile generation
	treeShaking: true,
	alias: {
		'crypto': '#src/scripts/fallbacks/crypto.ts',
		'koffi': '#src/scripts/fallbacks/empty.ts',
		'ip-cidr': '#src/scripts/fallbacks/empty.ts',
		'snarkjs': '#src/scripts/fallbacks/empty.ts',
		're2': '#src/scripts/fallbacks/re2.ts',
	},
	external: [
		'dotenv',
		'elastic-apm-node',
		'https-proxy-agent',
		'ip-cidr',
		'serve-static',
		're2',
		'snarkjs',
		'ws',

		'fs/promises',
		'path',
	],
})

if(process.argv.includes('--analyze')) {
	// Analyze the metafile
	const analysis = await esbuild.analyzeMetafile(rslt.metafile)
	console.log(analysis)
}