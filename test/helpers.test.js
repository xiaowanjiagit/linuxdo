'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const helpers = require(path.join(__dirname, '..', 'src', 'linuxdo-automation.user.js'));

test('getPageTypeFromPath classifies Discourse paths', () => {
  assert.strictEqual(helpers.getPageTypeFromPath('/t/topic/123'), 'topic');
  assert.strictEqual(helpers.getPageTypeFromPath('/t/topic/123/45'), 'topic');
  assert.strictEqual(helpers.getPageTypeFromPath('/latest'), 'list');
  assert.strictEqual(helpers.getPageTypeFromPath('/new'), 'list');
  assert.strictEqual(helpers.getPageTypeFromPath('/unread'), 'list');
  assert.strictEqual(helpers.getPageTypeFromPath('/top'), 'list');
  assert.strictEqual(helpers.getPageTypeFromPath('/hot'), 'list');
  assert.strictEqual(helpers.getPageTypeFromPath('/'), 'list');
  assert.strictEqual(helpers.getPageTypeFromPath('/c/develop/4'), 'list');
  assert.strictEqual(helpers.getPageTypeFromPath('/u/someone'), 'other');
  assert.strictEqual(helpers.getPageTypeFromPath('/admin'), 'other');
});

test('getTopicIdFromUrl extracts numeric topic id', () => {
  assert.strictEqual(helpers.getTopicIdFromUrl('https://linux.do/t/topic/9876'), '9876');
  assert.strictEqual(helpers.getTopicIdFromUrl('/t/topic/42/10'), '42');
  assert.strictEqual(helpers.getTopicIdFromUrl('/latest'), null);
  assert.strictEqual(helpers.getTopicIdFromUrl(undefined), null);
});

test('trimSet keeps only the newest entries within max', () => {
  const set = new Set([1, 2, 3, 4, 5]);
  helpers.trimSet(set, 3);
  assert.deepStrictEqual([...set], [3, 4, 5]);
  helpers.trimSet(set, 10);
  assert.strictEqual(set.size, 3);
});

test('randomInt stays within the inclusive range', () => {
  for (let i = 0; i < 500; i++) {
    const v = helpers.randomInt(2, 5);
    assert.ok(v >= 2 && v <= 5, `out of range: ${v}`);
    assert.ok(Number.isInteger(v));
  }
});
