module.exports = {
	testEnvironment: 'node',
	roots: [
		'<rootDir>/src'
	],
	testPathIgnorePatterns: [
		'/node_modules/'
	],
	testMatch: [
		'**/src/tests/test.*.+(ts|tsx)',
	],
	transform: {
		'^.+\\.(js|ts|tsx)?$': [
			'@swc/jest',
		]
	},
	transformIgnorePatterns: [
		'"node_modules/(?!p-queue/.*)"'
	],
	setupFiles: [
		'./src/tests/mocks.ts',
	],
	moduleNameMapper: {
		'^src/(.*)': '<rootDir>/src/$1',
	}
}
