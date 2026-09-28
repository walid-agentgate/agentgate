import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/policy-engine.js';

test('allows low amount',()=>assert.equal(evaluate({action:'refund',amount:420}).decision,'ASK'));
test('blocks export_all',()=>assert.equal(evaluate({action:'export_all'}).decision,'BLOCK'));
test('blocks high amount',()=>assert.equal(evaluate({action:'refund',amount:9000}).decision,'BLOCK'));
test('allows read',()=>assert.equal(evaluate({action:'read'}).decision,'ALLOW'));
