import express from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();

  const key = process.env.GIPHY_API_KEY;
  if (!key) {
    return res.status(501).json({ error: 'No sticker search key configured' });
  }

  try {
    const endpoint = q
      ? 'https://api.giphy.com/v1/gifs/search'
      : 'https://api.giphy.com/v1/gifs/trending';

    const url = new URL(endpoint);
    url.searchParams.set('api_key', key);
    url.searchParams.set('limit', '36');
    url.searchParams.set('rating', 'pg');

    if (q) {
      url.searchParams.set('q', q);
    }

    const r = await fetch(url);

    if (!r.ok) {
      const text = await r.text();
      console.error('GIPHY search failed:', r.status, text);
      return res.status(502).json({ error: 'GIF provider failed' });
    }

    const data = await r.json();

    const results = (data?.data || []).map((it) => {
      const tiny =
        it.images?.fixed_width_small?.url ||
        it.images?.preview_gif?.url ||
        it.images?.fixed_width?.url ||
        it.images?.original?.url;

      const med =
        it.images?.downsized_medium?.url ||
        it.images?.fixed_width?.url ||
        it.images?.downsized?.url ||
        it.images?.original?.url ||
        tiny;

      const width =
        it.images?.downsized_medium?.width ||
        it.images?.fixed_width?.width ||
        it.images?.downsized?.width ||
        it.images?.original?.width;

      const height =
        it.images?.downsized_medium?.height ||
        it.images?.fixed_width?.height ||
        it.images?.downsized?.height ||
        it.images?.original?.height;

      return {
        id: it.id,
        kind: 'GIF',
        url: med || tiny,
        thumb: tiny || med,
        mimeType: 'image/gif',
        width: Number(width) || null,
        height: Number(height) || null,
        provider: 'giphy',
        providerId: it.id,
      };
    });

    res.json({ results });
  } catch (e) {
    console.error('sticker search failed', e);
    res.status(500).json({ error: 'search failed' });
  }
});

export default router;