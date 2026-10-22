import { BrowserRouter } from 'react-router-dom'

/**
 * Clean, real URLs (`/v/<id>/`) instead of the old hash routes.
 *
 * Static hosts serve the prerendered `v/<id>/index.html` file for each video,
 * so those are 200 responses with full metadata. Unknown paths (and videos
 * added after the build) fall back to `404.html`, which hosts the same app, so
 * a direct link still plays.
 */
export const RouterProvider = BrowserRouter
