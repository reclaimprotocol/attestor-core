module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: [
		'<rootDir>/src'
	],
	testPathIgnorePatterns: [
		'/node_modules/'
	],
	testMatch: [
		'**/tests/test.*.+(ts|tsx)',
	],
	transform: {
		'^.+\\.(js|ts|tsx)?$': '@swc/jest'
	},
	transformIgnorePatterns: [
		'"node_modules/(?!p-queue/.*)"'
	],
	setupFiles: [
		'./src/tests/mocks.ts',
	],
}
