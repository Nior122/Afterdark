import { HashRouter } from 'react-router-dom'

// Deployment note: AfterDark ships with a HashRouter (`/#/watch/...`) so the
// static build works on any host — GitHub Pages, Netlify, Vercel, S3 — with no
// rewrite rules at all. To use clean paths instead, swap HashRouter for
// BrowserRouter below; the host must then serve index.html for unknown routes
// (vercel.json and netlify.toml in this repo already do that).
export const RouterProvider = HashRouter
