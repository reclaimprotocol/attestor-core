import stylistic from '@stylistic/eslint-plugin'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

export default [
	// Global ignores
	{
		ignores: [
			'lib/**',
			'coverage/**',
			'*.lock',
			'browser/**',
			'src/avs/abis/**',
			'src/avs/contracts/**',
			'expander-operator.js',
			'src/test.ts',
			'node_modules/**',
			'avs/**',
		],
	},
	// TypeScript config
	{
		files: ['src/**/*.ts'],
		plugins: {
			'@typescript-eslint': typescriptEslint,
			'@stylistic': stylistic,
			'simple-import-sort': simpleImportSort,
			'no-relative-import-paths': noRelativeImportPaths,
		},
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// TypeScript rules
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-unused-vars': 'error',
			'@typescript-eslint/prefer-optional-chain': 'error',

			// Import rules
			'no-relative-import-paths/no-relative-import-paths': [
				'error',
				{ allowSameFolder: false, rootDir: '' },
			],
			'simple-import-sort/imports': 'error',

			// Style rules
			'@stylistic/type-annotation-spacing': 'error',
			semi: ['error', 'never'],
			quotes: ['error', 'single', { avoidEscape: true }],
			indent: ['error', 'tab'],
			'no-trailing-spaces': 'error',
			'object-curly-spacing': ['error', 'always'],
			camelcase: ['error', { ignoreGlobals: true, ignoreImports: true }],
			eqeqeq: 'error',
			'prefer-const': 'error',
			curly: ['error', 'all'],
		},
	},
]
