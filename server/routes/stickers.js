import express from 'express';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ results: [] });

  const key = process.env.GIPHY_API_KEY;
  if (!key) {
    return res.status(501).json({ error: 'No sticker search key configured' });
  }

  try {
    const url = new URL('https://api.giphy.com/v1/gifs/search');
    url.searchParams.set('api_key', key);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '24');
    url.searchParams.set('rating', 'pg');

    const r = await fetch(url);
    const data = await r.json();

    const results = (data?.data || []).map((it) => {
      const tiny =
        it.images?.fixed_width_small?.url ||
        it.images?.preview_gif?.url ||
        it.images?.original?.url;

      const med =
        it.images?.downsized_medium?.url ||
        it.images?.fixed_width?.url ||
        it.images?.original?.url ||
        tiny;

      return {
        id: it.id,
        kind: 'GIF',
        url: med || tiny,
        thumb: tiny || med,
        mimeType: 'image/gif',
        width: Number(
          it.images?.downsized_medium?.width ||
            it.images?.fixed_width?.width ||
            it.images?.original?.width
        ) || null,
        height: Number(
          it.images?.downsized_medium?.height ||
            it.images?.fixed_width?.height ||
            it.images?.original?.height
        ) || null,
      };
    });

    res.json({ results });
  } catch (e) {
    console.error('sticker search failed', e);
    res.status(500).json({ error: 'search failed' });
  }
});

export default router;