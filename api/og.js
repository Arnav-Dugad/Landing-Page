/* ===========================================================================
   api/og.js  —  GET /api/og?p=<project-slug>   (Vercel)
   Renders a 1200x630 social card for one project, on the edge, at request
   time. Nothing is pre-built, so a card is correct the moment a project is
   edited. The layout lives in _card.js, shared with the Cloudflare worker.
   =========================================================================== */

import { ImageResponse } from '@vercel/og';
import { buildCard } from './_card.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
    const [card, options] = await buildCard(req);
    return new ImageResponse(card, options);
}
