import * as esbuild from 'esbuild'

const rslt = await esbuild.build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	minify: true,
	outfile: 'browser/resources/attestor.min.js',
	platform: 'browser',
	format: 'esm',
	tsconfig: 'tsconfig.build.json',
	legalComments: 'none',
	metafile: true, // Enable metafile generation
	alias: {
		'crypto': '#src/scripts/fallbacks/crypto.ts',
		'koffi': '#src/scripts/fallbacks/empty.ts',
		'ip-cidr': '#src/scripts/fallbacks/empty.ts',
		'snarkjs': '#src/scripts/fallbacks/snarkjs.ts',
		're2': '#src/scripts/fallbacks/empty.ts',
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