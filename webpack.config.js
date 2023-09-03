const path = require('path')

module.exports = {
	entry: './src/index.ts',
	target: 'web',
	output: {
		libraryTarget: 'commonjs2',
		filename: 'reclaim-witness.min.js',
		path: process.env.BUNDLE_PATH
			|| path.resolve(__dirname, 'browser')
	},
	mode: process.env.NODE_ENV
		|| 'development',
	resolve: {
		extensions: ['.webpack.js', '.web.js', '.ts', '.js', '.json'],
		alias: {
			'@xmldom/xmldom': false,
			'jsdom': false
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
			"react-native-tcp-socket": false,
			readline: false,
			constants: false,
			process: false,
			assert: false
		}
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
	},
}