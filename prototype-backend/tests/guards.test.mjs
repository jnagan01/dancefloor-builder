import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretMatches, validTestUser, assertSyntheticSave, assertTestLookup } from '../src/guards.mjs';
const secret = 'a'.repeat(43);
test('pairing rejects absent, short, wrong, and unequal-length tokens', () => {
  assert.equal(secretMatches(secret, secret), true);
  for (const bad of [null, undefined, '', 'a'.repeat(42), 'b'.repeat(43), 'a'.repeat(44)]) assert.equal(secretMatches(bad, secret), false);
  assert.equal(secretMatches('short', 'short'), false);
});
test('test access requires server-controlled application metadata and an exact test email', () => {
  const user = { email: 'setarchitect-prototype-a@example.com', app_metadata: { setarchitect_environment: 'prototype-test' } };
  assert.equal(validTestUser(user), true);
  assert.equal(validTestUser({ ...user, email: 'real-account@example.com' }), false);
  assert.equal(validTestUser({ email: user.email, user_metadata: user.app_metadata }), false);
  assert.equal(validTestUser({ ...user, app_metadata: {} }), false);
});
test('test event save refuses real clients, tracks, filesystem paths, and secrets', () => {
  const request = { name: 'Prototype Event', inputs: { eventName: 'Prototype Event', songs: [{ artist: 'Prototype Artist 01', song: 'Test Track 01' }] }, lists: { warmUp: [], transition: [], peak: [] } };
  assert.doesNotThrow(() => assertSyntheticSave(request));
  assert.throws(() => assertSyntheticSave({ ...request, name: 'Client Wedding' }));
  assert.throws(() => assertSyntheticSave({ ...request, inputs: { ...request.inputs, songs: [{ artist: 'Actual music', song: 'Actual song' }] } }));
  for (const path of ['/Users/example/Music/song.mp3', '/Volumes/Drive/song.mp3', 'C:\\Music\\song.mp3', 'sb_secret_private']) assert.throws(() => assertSyntheticSave({ ...request, lists: { ...request.lists, selections: { row: { paths: [path] } } } }));
});
test('real online lookups are confined to synthetic songs and a fixed public fixture', () => {
  assert.doesNotThrow(() => assertTestLookup({ songs: [{ artist: 'Earth, Wind & Fire', song: 'September' }] }));
  assert.doesNotThrow(() => assertTestLookup({ artist: 'Prototype Artist 01', title: 'Test Track 01' }));
  assert.throws(() => assertTestLookup({ artist: 'Client request', title: 'Private input' }));
});
