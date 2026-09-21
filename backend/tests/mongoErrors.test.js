// Unit tests for the MongoDB connection helpers (no database required).
//
//   cd backend && npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  redactUri,
  connectionTarget,
  connectionHints,
  formatConnectionError,
} = require('../lib/mongoErrors');

test('redactUri hides the password but keeps the user and host', () => {
  assert.equal(
    redactUri('mongodb+srv://app:hunter2@cluster0.abc123.mongodb.net/meditrack?retryWrites=true'),
    'mongodb+srv://app:********@cluster0.abc123.mongodb.net/meditrack?retryWrites=true'
  );
  assert.equal(redactUri('mongodb://127.0.0.1:27017/meditrack'), 'mongodb://127.0.0.1:27017/meditrack');
});

test('connectionTarget distinguishes local from cloud MongoDB', () => {
  const local = connectionTarget('mongodb://127.0.0.1:27017/meditrack');
  assert.equal(local.cloud, false);
  assert.equal(local.host, '127.0.0.1:27017');

  const atlas = connectionTarget('mongodb+srv://app:secret@cluster0.abc123.mongodb.net/meditrack');
  assert.equal(atlas.cloud, true);
  assert.equal(atlas.host, 'cluster0.abc123.mongodb.net');
  assert.equal(atlas.uri.includes('secret'), false, 'the password must not survive');
});

test('connectionHints explains bad credentials / unencoded passwords', () => {
  const hints = connectionHints({ message: 'MongoServerError: bad auth : Authentication failed.' }).join(' ');
  assert.match(hints, /URL-encode/);
});

test('connectionHints explains DNS / SRV failures', () => {
  const hints = connectionHints({
    message: 'querySrv ENOTFOUND _mongodb._tcp.cluster0.fake.mongodb.net',
  }).join(' ');
  assert.match(hints, /hostname did not resolve/);
});

test('connectionHints explains Atlas network-access failures', () => {
  const hints = connectionHints(
    {
      message:
        'Could not connect to any servers in your MongoDB Atlas cluster. One common reason is ' +
        'that you are trying to access the database from an IP that is not whitelisted.',
    },
    { cloud: true }
  ).join(' ');
  assert.match(hints, /Network Access/);
});

test('connectionHints points at local MongoDB when no cloud host is used', () => {
  const hints = connectionHints({ message: 'connect ECONNREFUSED 127.0.0.1:27017' }, { cloud: false }).join(' ');
  assert.match(hints, /Start MongoDB locally/);
  assert.doesNotMatch(hints, /Network Access/);
});

test('connectionHints always gives at least one suggestion', () => {
  const hints = connectionHints(new Error('something completely unexpected'));
  assert.equal(hints.length >= 1, true);
});

test('formatConnectionError names the host and lists hints', () => {
  const msg = formatConnectionError(
    new Error('connect ECONNREFUSED 127.0.0.1:27099'),
    'mongodb://127.0.0.1:27099/meditrack'
  );
  assert.match(msg, /Could not connect to MongoDB at 127\.0\.0\.1:27099/);
  assert.match(msg, /Hints:/);
  assert.match(msg, /ECONNREFUSED/);
});
