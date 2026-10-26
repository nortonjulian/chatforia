import express from 'express';
import path from 'path';

/**
 * Avatars are public profile assets. Chat media, stories and thumbnails are not.
 *
 * The old catch-all express.static('uploads') mount could serve private media
 * without checking the requesting user's room/story permissions.
 *
 * Keep the established public avatar URL contract, but never expose the
 * sibling media/, thumbs/ or user/ directories through static middleware.
 */
export function mountPublicAvatarFiles(
  app,
  { uploadsRoot = process.env.UPLOADS_DIR || path.resolve('uploads') } = {}
) {
  const avatarRoot = path.resolve(uploadsRoot, 'avatars');
  app.use('/uploads/avatars', express.static(avatarRoot, {
    dotfiles: 'deny',
    index: false,
    fallthrough: false,
  }));
}
