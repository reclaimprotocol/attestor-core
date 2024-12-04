const path = require('path')
const TsConfigPathsPlugin = require('tsconfig-paths-webpack-plugin')

module.exports = {
	entry: './src/index.ts',
	target: 'web',
	output: {
		libraryTarget: 'commonjs2',
		filename: 'attestor.min.js',
		path: process.env.BUNDLE_PATH
			|| path.resolve(__dirname, 'browser/resources')
	},
	mode: process.env.NODE_ENV
		|| 'development',
	resolve: {
		extensions: ['.webpack.js', '.web.js', '.ts', '.js', '.json'],
		alias: {
			'jsdom': false,
			'dotenv': false,
			're2': false,
            'koffi':false,
			[path.resolve(__dirname, 'node_modules/@reclaimprotocol/zk-symmetric-crypto/lib/expander/operator.js')]:
                path.resolve(__dirname, 'expander-operator.js')
		},
		fallback: {
			"fs": false,
			"path": false,
			"os": false,
			"crypto": false,
			"stream": false,
			"http": false,
			"tls": false,
			"zlib": false,
			"https": false,
			"net": false,
			readline: false,
			constants: false,
			process: false,
			assert: false
		},
		plugins: [
			new TsConfigPathsPlugin({ configFile: './tsconfig.build.json' })
		]
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				loader: 'ts-loader',
				options: {
					transpileOnly: true
				},
				exclude: /node_modules/,
			},
		],
	}
}