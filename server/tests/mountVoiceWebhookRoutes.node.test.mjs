import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { mountVoiceWebhookRoutes } from '../routes/mountVoiceWebhookRoutes.js';

test('app Voice inbound wins while distinct legacy callbacks remain reachable', async () => {
  const app = express();
  const voiceWebhooks = express.Router();
  const legacyWebhooks = express.Router();

  voiceWebhooks.post('/inbound', (_req, res) => res.send('app-voice'));
  legacyWebhooks.post('/voice/inbound', (_req, res) => res.send('forwarding'));
  legacyWebhooks.post('/voice/inbound/after-dial', (_req, res) => res.send('after-dial'));

  mountVoiceWebhookRoutes(app, { voiceWebhooks, legacyWebhooks });

  assert.equal((await request(app).post('/webhooks/voice/inbound')).text, 'app-voice');
  assert.equal((await request(app).post('/api/webhooks/voice/inbound')).text, 'app-voice');
  assert.equal((await request(app).post('/webhooks/voice/inbound/after-dial')).text, 'after-dial');
});
