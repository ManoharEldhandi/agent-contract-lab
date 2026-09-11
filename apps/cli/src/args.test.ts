import assert from 'node:assert/strict';
import { test } from 'node:test';

import { optionFlag, optionString, parseArgs } from './args';

test('collects positionals', () => {
	assert.deepEqual(parseArgs(['doctor']).positionals, ['doctor']);
	assert.deepEqual(parseArgs(['supervisor', 'status']).positionals, ['supervisor', 'status']);
});

test('parses --key value and --key=value', () => {
	assert.equal(parseArgs(['--supervisor-url', 'http://x']).options['supervisor-url'], 'http://x');
	assert.equal(parseArgs(['--format=json']).options.format, 'json');
});

test('treats a trailing --flag as boolean true', () => {
	assert.equal(parseArgs(['--require-supervisor']).options['require-supervisor'], true);
});

test('does not consume a following option as a value', () => {
	const parsed = parseArgs(['--format', '--json']);
	assert.equal(parsed.options.format, true);
	assert.equal(parsed.options.json, true);
});

test('parses short boolean flags', () => {
	assert.equal(parseArgs(['-h']).options.h, true);
});

test('stops option parsing after --', () => {
	const parsed = parseArgs(['run', '--', '--not-an-option', 'x']);
	assert.deepEqual(parsed.positionals, ['run', '--not-an-option', 'x']);
});

test('optionString returns strings only', () => {
	const { options } = parseArgs(['--format', 'json', '--flag']);
	assert.equal(optionString(options, 'format'), 'json');
	assert.equal(optionString(options, 'flag'), undefined);
	assert.equal(optionString(options, 'missing'), undefined);
});

test('optionFlag recognizes boolean and "true"', () => {
	assert.equal(optionFlag(parseArgs(['--help']).options, 'help'), true);
	assert.equal(optionFlag(parseArgs(['--help=true']).options, 'help'), true);
	assert.equal(optionFlag(parseArgs(['--help=false']).options, 'help'), false);
	assert.equal(optionFlag(parseArgs([]).options, 'help', 'h'), false);
});
