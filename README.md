# Receipt Reader — Vercel deployment

This project turns the original PHP-wrapped static page into `index.html` and moves OCR.space requests to a Vercel serverless function. The OCR API key is read only from `process.env.OCR_SPACE_API_KEY` and is not shipped to the browser.

## Deploy
1. Rotate/revoke the old OCR.space key because it was embedded in browser code.
2. Upload these files to a GitHub repository (repository root should contain `index.html`, `api/ocr.js`, and `vercel.json`).
3. Import the repository in Vercel. The site is static HTML plus a Node.js serverless function; no PHP runtime is required.
4. In Vercel → Project → Settings → Environment Variables, add `OCR_SPACE_API_KEY` with the NEW key. Apply it to Production and Preview as needed, then redeploy.
5. Test the deployed site with a small receipt image. In browser DevTools → Network, the request should go to `/api/ocr`, not directly to `api.ocr.space`.
6. Connect the Spaceship domain after the deployment works: Vercel → Project → Settings → Domains → add the domain and follow the exact DNS records Vercel shows in Spaceship DNS. Do not guess A/CNAME values.

## Notes
- The browser sends the compressed image to `/api/ocr`; the function forwards it to OCR.space.
- This hides the key from page source, but the endpoint is public and can still be abused. Before sharing widely, add rate limiting or authentication and review OCR.space plan limits.
- Never commit a real `.env` file or API key to GitHub.
